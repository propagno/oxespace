//! OXE-400: one PTY session on portable-pty, shared by the N-API host (arm C) and the binary host (arm D).
//! The contract is the one terminal.service uses from node-pty: spawn, pid, data, exit code, write, resize, kill.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex, Once};
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

pub struct SpawnOptions {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    /// "KEY=value" pairs. When not empty they replace the host's environment.
    pub env: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

pub struct Session {
    pub pid: u32,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
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
        let master = self.master.lock().map_err(|_| anyhow!("master poisoned"))?;
        let master = master.as_ref().ok_or_else(|| anyhow!("session closed"))?;
        master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
        Ok(())
    }

    pub fn kill(&self) -> Result<()> {
        let mut killer = self.killer.lock().map_err(|_| anyhow!("killer poisoned"))?;
        killer.kill()?;
        Ok(())
    }

    /// Drops the pseudo terminal; on Windows this closes the pseudoconsole, which ends the reader.
    fn close(&self) {
        if let Ok(mut writer) = self.writer.lock() {
            writer.take();
        }
        if let Ok(mut master) = self.master.lock() {
            master.take();
        }
    }
}

static PRELOAD: Once = Once::new();

/// Windows: the app runs node-pty with `useConptyDll`, the conpty.dll + OpenConsole.exe that node-pty ships.
/// portable-pty prefers a module named conpty.dll over the system one, so loading node-pty's copy by its full path
/// first (POC_CONPTY_DLL) makes every arm use the same ConPTY. Elsewhere this does nothing.
pub fn preload_conpty() {
    PRELOAD.call_once(|| {
        #[cfg(windows)]
        if let Ok(path) = std::env::var("POC_CONPTY_DLL") {
            if !path.is_empty() {
                // SAFETY: conpty.dll has no initialisation side effects beyond being mapped; it stays loaded for the
                // life of the process, as portable-pty expects.
                match unsafe { libloading::Library::new(&path) } {
                    Ok(library) => std::mem::forget(library),
                    Err(error) => eprintln!("[pty-core] could not preload {path}: {error}"),
                }
            }
        }
    });
}

pub type OnData = Box<dyn FnMut(&[u8]) + Send>;
pub type OnExit = Box<dyn FnOnce(i64) + Send>;

pub fn spawn(options: SpawnOptions, mut on_data: OnData, on_exit: OnExit) -> Result<Arc<Session>> {
    preload_conpty();
    let pair = native_pty_system().openpty(PtySize {
        rows: options.rows.max(1),
        cols: options.cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut command = CommandBuilder::new(&options.file);
    command.args(&options.args);
    if let Some(cwd) = &options.cwd {
        command.cwd(cwd);
    }
    if !options.env.is_empty() {
        command.env_clear();
        for pair in &options.env {
            if let Some((key, value)) = pair.split_once('=') {
                if !key.is_empty() {
                    command.env(key, value);
                }
            }
        }
    }

    let mut child = pair.slave.spawn_command(command)?;
    drop(pair.slave);
    let pid = child.process_id().unwrap_or(0);
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    let session = Arc::new(Session {
        pid,
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(Some(writer)),
        killer: Mutex::new(killer),
    });

    thread::Builder::new().name(format!("pty-read-{pid}")).spawn(move || {
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => on_data(&buffer[..read]),
            }
        }
    })?;

    let waiter = session.clone();
    thread::Builder::new().name(format!("pty-wait-{pid}")).spawn(move || {
        let code = match child.wait() {
            Ok(status) => i64::from(status.exit_code()),
            Err(_) => -1,
        };
        // Let the pseudoconsole hand over its last frame before it is closed (Windows); harmless elsewhere.
        thread::sleep(Duration::from_millis(100));
        waiter.close();
        on_exit(code);
    })?;

    Ok(session)
}
