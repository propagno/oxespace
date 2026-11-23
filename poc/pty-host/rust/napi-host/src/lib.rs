//! OXE-400 arm C: the portable-pty session as a Node-API module, loaded in an Electron utility process.

use std::sync::Arc;

use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Error, JsFunction, Result};
use napi_derive::napi;

#[napi(object)]
pub struct SpawnOptions {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    /// "KEY=value" pairs; when present they replace the host's environment.
    pub env: Option<Vec<String>>,
    pub cols: u32,
    pub rows: u32,
}

#[napi]
pub struct PtyHandle {
    inner: Arc<pty_core::Session>,
}

fn reason(error: anyhow::Error) -> Error {
    Error::from_reason(error.to_string())
}

fn size(value: u32) -> u16 {
    u16::try_from(value).unwrap_or(u16::MAX)
}

#[napi]
impl PtyHandle {
    #[napi(getter)]
    pub fn pid(&self) -> u32 {
        self.inner.pid
    }

    #[napi]
    pub fn write(&self, data: Buffer) -> Result<()> {
        self.inner.write(&data).map_err(reason)
    }

    #[napi]
    pub fn resize(&self, cols: u32, rows: u32) -> Result<()> {
        self.inner.resize(size(cols), size(rows)).map_err(reason)
    }

    #[napi]
    pub fn kill(&self) -> Result<()> {
        self.inner.kill().map_err(reason)
    }
}

/// Starts a session. `on_data(Buffer)` gets the PTY's bytes, `on_exit(code)` once when the process ends.
#[napi]
pub fn spawn(options: SpawnOptions, on_data: JsFunction, on_exit: JsFunction) -> Result<PtyHandle> {
    let data: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> =
        on_data.create_threadsafe_function(0, |context: ThreadSafeCallContext<Vec<u8>>| {
            Ok(vec![Buffer::from(context.value)])
        })?;
    let exit: ThreadsafeFunction<i64, ErrorStrategy::Fatal> =
        on_exit.create_threadsafe_function(0, |context: ThreadSafeCallContext<i64>| Ok(vec![context.value]))?;

    let session = pty_core::spawn(
        pty_core::SpawnOptions {
            file: options.file,
            args: options.args,
            cwd: options.cwd,
            env: options.env.unwrap_or_default(),
            cols: size(options.cols),
            rows: size(options.rows),
        },
        Box::new(move |bytes: &[u8]| {
            data.call(bytes.to_vec(), ThreadsafeFunctionCallMode::NonBlocking);
        }),
        Box::new(move |code: i64| {
            exit.call(code, ThreadsafeFunctionCallMode::NonBlocking);
        }),
    )
    .map_err(reason)?;
    Ok(PtyHandle { inner: session })
}

/// CA-1: a forced panic. The release profile aborts on panic, so this ends the host process like a native fault.
#[napi]
pub fn crash() {
    panic!("OXE-400: forced panic in the PTY host");
}
