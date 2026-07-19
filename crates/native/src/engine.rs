use std::sync::{Arc, Mutex};

use napi::{Env, Status, threadsafe_function::ThreadsafeFunction};

use crate::{TransferId, command::RequestData, error::NativeError};

pub type RawEventListener = ThreadsafeFunction<(String,), (), (String,), Status, false>;
pub type EventListener = Arc<RawEventListener>;

#[cfg(feature = "native-curl")]
mod implementation {
    use std::{
        ffi::c_void,
        ptr,
        sync::{
            Arc, Mutex,
            atomic::{AtomicPtr, Ordering},
            mpsc::{self, Sender},
        },
        thread::{self, JoinHandle},
    };

    use super::*;
    use crate::{
        body::{BodyRegistry, SharedTransfer},
        command::{Command, StartTransfer},
        ffi, reactor,
    };

    pub struct Engine {
        sender: Sender<Command>,
        multi: Arc<AtomicPtr<c_void>>,
        registry: Arc<BodyRegistry>,
        reactor: Mutex<Option<JoinHandle<()>>>,
    }

    impl Engine {
        pub fn new() -> std::result::Result<Self, NativeError> {
            let (sender, receiver) = mpsc::channel();
            let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
            let multi = Arc::new(AtomicPtr::new(ptr::null_mut()));
            let registry = Arc::new(BodyRegistry::default());
            let reactor_multi = Arc::clone(&multi);
            let reactor_registry = Arc::clone(&registry);
            let reactor = thread::Builder::new()
                .name("fetch-impersonate-reactor".to_owned())
                .spawn(move || {
                    reactor::run(receiver, ready_sender, reactor_multi, reactor_registry);
                })
                .map_err(|error| NativeError::Internal {
                    message: format!("could not start curl reactor: {error}"),
                })?;

            ready_receiver.recv().map_err(|_| NativeError::Internal {
                message: "curl reactor exited during initialization".to_owned(),
            })??;

            Ok(Self {
                sender,
                multi,
                registry,
                reactor: Mutex::new(Some(reactor)),
            })
        }

        pub fn start(
            &self,
            id: TransferId,
            request: RequestData,
            listener: RawEventListener,
        ) -> std::result::Result<(), NativeError> {
            let shared = Arc::new(SharedTransfer::default());
            let listener = Arc::new(listener);
            self.registry.insert(id, Arc::clone(&shared));
            if self
                .sender
                .send(Command::Start(Box::new(StartTransfer {
                    id,
                    request,
                    listener,
                    shared,
                })))
                .is_err()
            {
                self.registry.remove(id);
                return Err(NativeError::Internal {
                    message: "curl reactor is not running".to_owned(),
                });
            }
            self.wakeup();
            Ok(())
        }

        pub fn read_body(&self, id: TransferId) -> Option<Vec<u8>> {
            let shared = self.registry.get(id)?;
            let chunk = shared.pop();
            if shared.should_resume() {
                let _ = self.sender.send(Command::ResumeDownload(id));
                self.wakeup();
            }
            if chunk.is_none() && shared.complete.load(Ordering::Acquire) && shared.is_empty() {
                self.registry.remove(id);
            }
            chunk
        }

        pub fn cancel(&self, id: TransferId) {
            if self.sender.send(Command::Cancel(id)).is_ok() {
                self.wakeup();
            }
        }

        pub fn shutdown(&self) {
            let mut reactor = self.reactor.lock().expect("reactor mutex poisoned");
            let Some(handle) = reactor.take() else { return };
            let _ = self.sender.send(Command::Shutdown);
            self.wakeup();
            let _ = handle.join();
        }

        pub fn version(&self) -> (String, String) {
            let curl = unsafe {
                let version = ffi::curl_version();
                if version.is_null() {
                    "unknown".to_owned()
                } else {
                    std::ffi::CStr::from_ptr(version)
                        .to_string_lossy()
                        .into_owned()
                }
            };
            (curl, env!("FI_CURL_IMPERSONATE_VERSION").to_owned())
        }

        fn wakeup(&self) {
            let multi = self.multi.load(Ordering::Acquire).cast::<ffi::CURLM>();
            if !multi.is_null() {
                unsafe {
                    ffi::curl_multi_wakeup(multi);
                }
            }
        }
    }

    impl Drop for Engine {
        fn drop(&mut self) {
            self.shutdown();
        }
    }
}

#[cfg(feature = "native-stub")]
mod implementation {
    use super::*;

    pub struct Engine;

    impl Engine {
        pub fn new() -> std::result::Result<Self, NativeError> {
            Ok(Self)
        }

        pub fn start(
            &self,
            _id: TransferId,
            _request: RequestData,
            _listener: RawEventListener,
        ) -> std::result::Result<(), NativeError> {
            Err(NativeError::Internal {
                message: "native stub cannot perform requests".to_owned(),
            })
        }

        pub fn read_body(&self, _id: TransferId) -> Option<Vec<u8>> {
            None
        }
        pub fn cancel(&self, _id: TransferId) {}
        pub fn shutdown(&self) {}
        pub fn version(&self) -> (String, String) {
            ("unavailable".to_owned(), "unavailable".to_owned())
        }
    }
}

pub use implementation::Engine;

#[derive(Default)]
pub struct EnvironmentEngine {
    engine: Mutex<Option<Arc<Engine>>>,
}

impl EnvironmentEngine {
    fn get(&self) -> std::result::Result<Arc<Engine>, NativeError> {
        let mut engine = self.engine.lock().map_err(|_| NativeError::Internal {
            message: "environment engine mutex poisoned".to_owned(),
        })?;
        if engine.is_none() {
            *engine = Some(Arc::new(Engine::new()?));
        }
        Ok(Arc::clone(engine.as_ref().expect("engine was initialized")))
    }

    pub fn shutdown(&self) {
        let engine = self.engine.lock().ok().and_then(|mut engine| engine.take());
        if let Some(engine) = engine {
            engine.shutdown();
        }
    }
}

pub fn shared_engine(env: &Env) -> napi::Result<Arc<Engine>> {
    env.get_instance_data::<Arc<EnvironmentEngine>>()?
        .ok_or_else(|| {
            napi::Error::new(
                Status::GenericFailure,
                "native environment is not initialized",
            )
        })?
        .get()
        .map_err(napi::Error::from)
}
