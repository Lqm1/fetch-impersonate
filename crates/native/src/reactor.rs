use std::{
    collections::HashMap,
    ffi::{CStr, c_int, c_void},
    ptr,
    sync::{
        Arc,
        atomic::{AtomicPtr, Ordering},
        mpsc::{Receiver, SyncSender, TryRecvError},
    },
};

use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use serde_json::json;

use crate::{
    TransferId,
    body::BodyRegistry,
    command::{Command, StartTransfer},
    error::NativeError,
    ffi,
    transfer::Transfer,
};

pub fn run(
    receiver: Receiver<Command>,
    ready: SyncSender<Result<(), NativeError>>,
    shared_multi: Arc<AtomicPtr<c_void>>,
    registry: Arc<BodyRegistry>,
) {
    let global = unsafe { ffi::curl_global_init(ffi::CURL_GLOBAL_ALL) };
    if global != ffi::CURLE_OK {
        let _ = ready.send(Err(NativeError::Internal {
            message: format!("curl_global_init failed with code {global}"),
        }));
        return;
    }
    let multi = unsafe { ffi::curl_multi_init() };
    if multi.is_null() {
        let _ = ready.send(Err(NativeError::Internal {
            message: "curl_multi_init returned null".to_owned(),
        }));
        unsafe {
            ffi::curl_global_cleanup();
        }
        return;
    }
    shared_multi.store(multi.cast(), Ordering::Release);
    let _ = ready.send(Ok(()));

    let mut transfers: HashMap<TransferId, Box<Transfer>> = HashMap::new();
    let mut shutting_down = false;

    while !shutting_down {
        loop {
            match receiver.try_recv() {
                Ok(Command::Start(start)) => {
                    start_transfer(multi, *start, &mut transfers, &registry)
                }
                Ok(Command::Cancel(id)) => cancel_transfer(multi, id, &mut transfers, &registry),
                Ok(Command::ResumeDownload(id)) => resume_transfer(id, &mut transfers),
                Ok(Command::Shutdown) => {
                    shutting_down = true;
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    shutting_down = true;
                    break;
                }
            }
        }
        if shutting_down {
            break;
        }

        let mut running = 0;
        let perform = unsafe { ffi::curl_multi_perform(multi, &mut running) };
        if perform != ffi::CURLM_OK {
            fail_all(multi, &mut transfers, &registry, curl_multi_error(perform));
            continue;
        }
        collect_completions(multi, &mut transfers, &registry);

        let mut activity = 0;
        let poll = unsafe { ffi::curl_multi_poll(multi, ptr::null_mut(), 0, 1_000, &mut activity) };
        if poll != ffi::CURLM_OK {
            fail_all(multi, &mut transfers, &registry, curl_multi_error(poll));
        }
    }

    for (id, mut transfer) in transfers.drain() {
        unsafe {
            ffi::curl_multi_remove_handle(multi, transfer.easy);
        }
        transfer.cancel();
        registry.remove(id);
    }
    shared_multi.store(ptr::null_mut(), Ordering::Release);
    unsafe {
        ffi::curl_multi_cleanup(multi);
        ffi::curl_global_cleanup();
    }
}

fn start_transfer(
    multi: *mut ffi::CURLM,
    start: StartTransfer,
    transfers: &mut HashMap<TransferId, Box<Transfer>>,
    registry: &BodyRegistry,
) {
    let id = start.id;
    let listener = start.listener;
    let transfer = Transfer::new(id, start.request, listener.clone(), start.shared);
    let transfer = match transfer {
        Ok(transfer) => transfer,
        Err(error) => {
            send_error(&listener, id, &error);
            registry.remove(id);
            return;
        }
    };
    let result = unsafe { ffi::curl_multi_add_handle(multi, transfer.easy) };
    if result != ffi::CURLM_OK {
        let error = curl_multi_error(result);
        send_error(&listener, id, &error);
        registry.remove(id);
        return;
    }
    transfers.insert(id, transfer);
}

fn cancel_transfer(
    multi: *mut ffi::CURLM,
    id: TransferId,
    transfers: &mut HashMap<TransferId, Box<Transfer>>,
    registry: &BodyRegistry,
) {
    let Some(mut transfer) = transfers.remove(&id) else {
        return;
    };
    unsafe {
        ffi::curl_multi_remove_handle(multi, transfer.easy);
    }
    transfer.cancel();
    registry.remove(id);
}

fn resume_transfer(id: TransferId, transfers: &mut HashMap<TransferId, Box<Transfer>>) {
    if let Some(transfer) = transfers.get_mut(&id) {
        unsafe {
            ffi::curl_easy_pause(transfer.easy, ffi::CURLPAUSE_CONT);
        }
    }
}

fn collect_completions(
    multi: *mut ffi::CURLM,
    transfers: &mut HashMap<TransferId, Box<Transfer>>,
    registry: &BodyRegistry,
) {
    loop {
        let mut queued: c_int = 0;
        let message = unsafe { ffi::curl_multi_info_read(multi, &mut queued) };
        if message.is_null() {
            break;
        }
        let message = unsafe { &*message };
        if message.msg != ffi::CURLMSG_DONE {
            continue;
        }
        let id = transfers
            .iter()
            .find_map(|(id, transfer)| (transfer.easy == message.easy_handle).then_some(*id));
        let Some(id) = id else { continue };
        let mut transfer = transfers
            .remove(&id)
            .expect("completed transfer disappeared");
        unsafe {
            ffi::curl_multi_remove_handle(multi, transfer.easy);
        }
        let result = unsafe { message.data.result };
        transfer.complete(result);
        if result != ffi::CURLE_OK {
            registry.remove(id);
        }
    }
}

fn fail_all(
    multi: *mut ffi::CURLM,
    transfers: &mut HashMap<TransferId, Box<Transfer>>,
    registry: &BodyRegistry,
    error: NativeError,
) {
    let message = error.to_string();
    for (id, mut transfer) in transfers.drain() {
        unsafe {
            ffi::curl_multi_remove_handle(multi, transfer.easy);
        }
        transfer.fail(&error);
        registry.remove(id);
    }
    eprintln!("fetch-impersonate reactor failure: {message}");
}

fn send_error(listener: &crate::engine::EventListener, id: TransferId, error: &NativeError) {
    let event = json!({
        "type": "error",
        "transferId": id.to_string(),
        "error": error.serializable(),
    });
    let _ = listener.call(
        (event.to_string(),),
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

fn curl_multi_error(code: ffi::CURLMcode) -> NativeError {
    let message = unsafe { CStr::from_ptr(ffi::curl_multi_strerror(code)) }
        .to_string_lossy()
        .into_owned();
    NativeError::CurlMulti {
        code,
        name: format!("CURLM_{code}"),
        message,
    }
}
