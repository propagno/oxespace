//! OXE-400 arm D: the portable-pty sessions in their own process, driven over stdin/stdout with a small framing.
//!
//! Frame: kind (u8), session id (u32 LE), payload length (u32 LE), payload.
//! In:  1 SPAWN  payload = fields joined by NUL: file, cwd, cols, rows, argc, args…, envc, env "K=V"…
//!      2 WRITE  payload = bytes        3 RESIZE payload = cols (u16 LE), rows (u16 LE)
//!      4 KILL                          5 CRASH  (forced panic: the release profile aborts the process, CA-1)
//! Out: 101 SPAWNED payload = pid (u32 LE)   102 DATA payload = bytes
//!      103 EXIT payload = code (i64 LE)     104 ERROR payload = UTF-8 message
//! When stdin ends (the app is gone) every session is killed and the host exits.

use std::collections::HashMap;
use std::io::{self, BufWriter, Read, Write};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread;

const SPAWN: u8 = 1;
const WRITE: u8 = 2;
const RESIZE: u8 = 3;
const KILL: u8 = 4;
const CRASH: u8 = 5;
const SPAWNED: u8 = 101;
const DATA: u8 = 102;
const EXIT: u8 = 103;
const ERROR: u8 = 104;

fn frame(kind: u8, id: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(9 + payload.len());
    out.push(kind);
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

fn parse_spawn(payload: &[u8]) -> Option<pty_core::SpawnOptions> {
    let text = std::str::from_utf8(payload).ok()?;
    let mut fields = text.split('\0');
    let file = fields.next()?.to_string();
    let cwd = fields.next()?.to_string();
    let cols = fields.next()?.parse().ok()?;
    let rows = fields.next()?.parse().ok()?;
    let argc: usize = fields.next()?.parse().ok()?;
    let args = (0..argc).map(|_| fields.next().map(str::to_string)).collect::<Option<Vec<_>>>()?;
    let envc: usize = fields.next()?.parse().ok()?;
    let env = (0..envc).map(|_| fields.next().map(str::to_string)).collect::<Option<Vec<_>>>()?;
    Some(pty_core::SpawnOptions { file, args, cwd: if cwd.is_empty() { None } else { Some(cwd) }, env, cols, rows })
}

fn spawn(id: u32, payload: &[u8], out: &Sender<Vec<u8>>) -> Result<Arc<pty_core::Session>, String> {
    let options = parse_spawn(payload).ok_or_else(|| "bad SPAWN payload".to_string())?;
    let data_out = out.clone();
    let exit_out = out.clone();
    let session = pty_core::spawn(
        options,
        Box::new(move |bytes: &[u8]| {
            let _ = data_out.send(frame(DATA, id, bytes));
        }),
        Box::new(move |code: i64| {
            let _ = exit_out.send(frame(EXIT, id, &code.to_le_bytes()));
        }),
    )
    .map_err(|error| error.to_string())?;
    let _ = out.send(frame(SPAWNED, id, &session.pid.to_le_bytes()));
    Ok(session)
}

fn main() {
    let (out, frames) = mpsc::channel::<Vec<u8>>();
    let writer = thread::spawn(move || {
        let mut stdout = BufWriter::with_capacity(256 * 1024, io::stdout().lock());
        while let Ok(first) = frames.recv() {
            if stdout.write_all(&first).is_err() {
                return;
            }
            while let Ok(next) = frames.try_recv() {
                if stdout.write_all(&next).is_err() {
                    return;
                }
            }
            if stdout.flush().is_err() {
                return;
            }
        }
    });

    let mut sessions: HashMap<u32, Arc<pty_core::Session>> = HashMap::new();
    let mut stdin = io::stdin().lock();
    let mut header = [0u8; 9];
    loop {
        if stdin.read_exact(&mut header).is_err() {
            break;
        }
        let kind = header[0];
        let id = u32::from_le_bytes([header[1], header[2], header[3], header[4]]);
        let len = u32::from_le_bytes([header[5], header[6], header[7], header[8]]) as usize;
        let mut payload = vec![0u8; len];
        if stdin.read_exact(&mut payload).is_err() {
            break;
        }
        let failure = match kind {
            SPAWN => match spawn(id, &payload, &out) {
                Ok(session) => {
                    sessions.insert(id, session);
                    None
                }
                Err(message) => Some(message),
            },
            WRITE => sessions.get(&id).and_then(|session| session.write(&payload).err().map(|e| e.to_string())),
            RESIZE if payload.len() >= 4 => sessions.get(&id).and_then(|session| {
                let cols = u16::from_le_bytes([payload[0], payload[1]]);
                let rows = u16::from_le_bytes([payload[2], payload[3]]);
                session.resize(cols, rows).err().map(|e| e.to_string())
            }),
            KILL => sessions.get(&id).and_then(|session| session.kill().err().map(|e| e.to_string())),
            CRASH => panic!("OXE-400: forced panic in the PTY host"),
            _ => Some(format!("unknown frame kind {kind}")),
        };
        if let Some(message) = failure {
            let _ = out.send(frame(ERROR, id, message.as_bytes()));
        }
    }

    for session in sessions.values() {
        let _ = session.kill();
    }
    // The sessions' threads still hold senders; give the writer a moment for their last frames, then leave.
    drop(out);
    drop(writer);
    thread::sleep(std::time::Duration::from_millis(300));
    std::process::exit(0);
}
