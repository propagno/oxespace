//! OXE-400: one PTY session, shared by the N-API host (arm C) and the binary host (arm D).
//! The contract is the one terminal.service uses from node-pty: spawn, pid, data, exit code, write, resize, kill.
//!
//! Windows: portable-pty on ConPTY. Unix: openpty + setsid here, because portable-pty's spawn closes every inherited
//! descriptor in the forked child, and inside an Electron process (arm C, a utility process) Chromium's descriptor
//! ownership check turns that close() into a crash of the child before it runs ("Crashing due to FD ownership
//! violation"). node-pty never closes descriptors in its child, which is why it works there.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Result};

pub struct SpawnOptions {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    /// "KEY=value" pairs. When not empty they replace the host's environment.
    pub env: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

/// What a platform's session can do besides reading and writing.
trait Control: Send {
    fn resize(&self, cols: u16, rows: u16) -> Result<()>;
    fn kill(&mut self) -> Result<()>;
}

pub struct Session {
    pub pid: u32,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    control: Mutex<Option<Box<dyn Control>>>,
}

impl Session {
    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().map_err(|_| anyhow!("writer poisoned"))?;
        let writer = writer.as_mut().ok_or_else(|| anyhow!("session closed"))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let control = self.control.lock().map_err(|_| anyhow!("control poisoned"))?;
        control.as_ref().ok_or_else(|| anyhow!("session closed"))?.resize(cols.max(1), rows.max(1))
    }

    pub fn kill(&self) -> Result<()> {
        let mut control = self.control.lock().map_err(|_| anyhow!("control poisoned"))?;
        control.as_mut().ok_or_else(|| anyhow!("session closed"))?.kill()
    }

    /// Drops the pseudo terminal; on Windows this closes the pseudoconsole, which ends the reader.
    fn close(&self) {
        if let Ok(mut writer) = self.writer.lock() {
            writer.take();
        }
        if let Ok(mut control) = self.control.lock() {
            control.take();
        }
    }
}

pub type OnData = Box<dyn FnMut(&[u8]) + Send>;
pub type OnExit = Box<dyn FnOnce(i64) + Send>;

fn env_pairs(options: &SpawnOptions) -> impl Iterator<Item = (&str, &str)> {
    options.env.iter().filter_map(|pair| pair.split_once('=')).filter(|(key, _)| !key.is_empty())
}

/// Windows: the app runs node-pty with `useConptyDll`, the conpty.dll + OpenConsole.exe that node-pty ships.
/// portable-pty prefers a module named conpty.dll over the system one, so loading node-pty's copy by its full path
/// first (POC_CONPTY_DLL) makes every arm use the same ConPTY. Elsewhere this does nothing.
pub fn preload_conpty() {
    #[cfg(windows)]
    windows_pty::preload_conpty();
}

#[cfg(windows)]
mod windows_pty {
    use std::sync::Once;

    use anyhow::Result;
    use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

    use super::{env_pairs, Control, SpawnOptions};

    static PRELOAD: Once = Once::new();

    pub fn preload_conpty() {
        PRELOAD.call_once(|| {
            if let Ok(path) = std::env::var("POC_CONPTY_DLL") {
                if !path.is_empty() {
                    // SAFETY: conpty.dll has no initialisation side effects beyond being mapped; it stays loaded for
                    // the life of the process, as portable-pty expects.
                    match unsafe { libloading::Library::new(&path) } {
                        Ok(library) => std::mem::forget(library),
                        Err(error) => eprintln!("[pty-core] could not preload {path}: {error}"),
                    }
                }
            }
        });
    }

    struct WindowsControl {
        master: Box<dyn MasterPty + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    }

    impl Control for WindowsControl {
        fn resize(&self, cols: u16, rows: u16) -> Result<()> {
            self.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
            Ok(())
        }

        fn kill(&mut self) -> Result<()> {
            self.killer.kill()?;
            Ok(())
        }
    }

    pub struct Spawned {
        pub pid: u32,
        pub reader: Box<dyn std::io::Read + Send>,
        pub writer: Box<dyn std::io::Write + Send>,
        pub control: Box<dyn Control>,
        pub wait: Box<dyn FnOnce() -> i64 + Send>,
    }

    pub fn spawn(options: &SpawnOptions) -> Result<Spawned> {
        preload_conpty();
        let pair = native_pty_system().openpty(PtySize { rows: options.rows.max(1), cols: options.cols.max(1), pixel_width: 0, pixel_height: 0 })?;
        let mut command = CommandBuilder::new(&options.file);
        command.args(&options.args);
        if let Some(cwd) = &options.cwd {
            command.cwd(cwd);
        }
        if !options.env.is_empty() {
            command.env_clear();
            for (key, value) in env_pairs(options) {
                command.env(key, value);
            }
        }
        let mut child: Box<dyn Child + Send + Sync> = pair.slave.spawn_command(command)?;
        drop(pair.slave);
        let pid = child.process_id().unwrap_or(0);
        let killer = child.clone_killer();
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        Ok(Spawned {
            pid,
            reader,
            writer,
            control: Box::new(WindowsControl { master: pair.master, killer }),
            wait: Box::new(move || match child.wait() {
                Ok(status) => i64::from(status.exit_code()),
                Err(_) => -1,
            }),
        })
    }
}

#[cfg(unix)]
mod unix_pty {
    use std::fs::File;
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::process::{CommandExt, ExitStatusExt};
    use std::process::{Command, Stdio};

    use anyhow::{bail, Result};

    use super::{env_pairs, Control, SpawnOptions};

    struct UnixControl {
        master: File,
        pid: libc::pid_t,
    }

    impl Control for UnixControl {
        fn resize(&self, cols: u16, rows: u16) -> Result<()> {
            let size = libc::winsize { ws_row: rows, ws_col: cols, ws_xpixel: 0, ws_ypixel: 0 };
            // SAFETY: TIOCSWINSZ reads one winsize from the pointer, which lives for the call.
            if unsafe { libc::ioctl(self.master.as_raw_fd(), libc::TIOCSWINSZ, &size) } == -1 {
                bail!(io::Error::last_os_error());
            }
            Ok(())
        }

        /// SIGHUP, node-pty's default kill signal: an interactive shell ignores SIGTERM but ends on a hangup.
        fn kill(&mut self) -> Result<()> {
            // SAFETY: kill(2) on the child's pid.
            if unsafe { libc::kill(self.pid, libc::SIGHUP) } == -1 {
                bail!(io::Error::last_os_error());
            }
            Ok(())
        }
    }

    pub struct Spawned {
        pub pid: u32,
        pub reader: Box<dyn io::Read + Send>,
        pub writer: Box<dyn io::Write + Send>,
        pub control: Box<dyn Control>,
        pub wait: Box<dyn FnOnce() -> i64 + Send>,
    }

    fn cloexec(fd: libc::c_int) {
        // SAFETY: fcntl on a descriptor this function's caller owns.
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    }

    pub fn spawn(options: &SpawnOptions) -> Result<Spawned> {
        let mut master: libc::c_int = -1;
        let mut slave: libc::c_int = -1;
        let mut size = libc::winsize { ws_row: options.rows.max(1), ws_col: options.cols.max(1), ws_xpixel: 0, ws_ypixel: 0 };
        // SAFETY: openpty writes the two descriptors; name and termios are optional (null).
        if unsafe { libc::openpty(&mut master, &mut slave, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) } != 0 {
            bail!(io::Error::last_os_error());
        }
        cloexec(master);
        cloexec(slave);
        // SAFETY: both descriptors were just opened and are owned here.
        let master = unsafe { File::from_raw_fd(master) };
        let slave = unsafe { File::from_raw_fd(slave) };

        let mut command = Command::new(&options.file);
        command.args(&options.args);
        if let Some(cwd) = &options.cwd {
            command.current_dir(cwd);
        }
        if !options.env.is_empty() {
            command.env_clear();
            command.envs(env_pairs(options));
        }
        command.stdin(Stdio::from(slave.try_clone()?)).stdout(Stdio::from(slave.try_clone()?)).stderr(Stdio::from(slave.try_clone()?));
        // SAFETY: only async-signal-safe calls between fork and exec; no descriptor is closed here.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                if libc::ioctl(0, libc::TIOCSCTTY as _, 0) == -1 {
                    return Err(io::Error::last_os_error());
                }
                // A host such as Electron blocks or handles signals; the shell starts from the defaults.
                let mut empty: libc::sigset_t = std::mem::zeroed();
                libc::sigemptyset(&mut empty);
                libc::pthread_sigmask(libc::SIG_SETMASK, &empty, std::ptr::null_mut());
                for signal in [libc::SIGCHLD, libc::SIGHUP, libc::SIGINT, libc::SIGQUIT, libc::SIGTERM, libc::SIGALRM, libc::SIGPIPE] {
                    libc::signal(signal, libc::SIG_DFL);
                }
                Ok(())
            });
        }
        let mut child = command.spawn()?;
        drop(slave);
        let pid = child.id();
        Ok(Spawned {
            pid,
            reader: Box::new(master.try_clone()?),
            writer: Box::new(master.try_clone()?),
            control: Box::new(UnixControl { master, pid: pid as libc::pid_t }),
            wait: Box::new(move || match child.wait() {
                Ok(status) => status.code().map(i64::from).or_else(|| status.signal().map(|signal| 128 + i64::from(signal))).unwrap_or(-1),
                Err(_) => -1,
            }),
        })
    }
}

#[cfg(windows)]
use windows_pty as platform;
#[cfg(unix)]
use unix_pty as platform;

pub fn spawn(options: SpawnOptions, mut on_data: OnData, on_exit: OnExit) -> Result<Arc<Session>> {
    let spawned = platform::spawn(&options)?;
    let pid = spawned.pid;
    let mut reader = spawned.reader;
    let wait = spawned.wait;
    let session = Arc::new(Session { pid, writer: Mutex::new(Some(spawned.writer)), control: Mutex::new(Some(spawned.control)) });

    thread::Builder::new().name(format!("pty-read-{pid}")).spawn(move || {
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => on_data(&buffer[..read]),
                // A signal in a host that has handlers (Node, Electron) interrupts a blocking read: read again.
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(1)),
                // Unix: EIO once the child is gone and the slave side is closed.
                Err(_) => break,
            }
        }
    })?;

    let waiter = session.clone();
    thread::Builder::new().name(format!("pty-wait-{pid}")).spawn(move || {
        let code = wait();
        // Let the PTY hand over its last frame before it is closed; on Windows closing ends the pseudoconsole.
        thread::sleep(Duration::from_millis(100));
        waiter.close();
        on_exit(code);
    })?;

    Ok(session)
}
