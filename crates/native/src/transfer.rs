use std::{
    ffi::{CStr, CString, c_char, c_long, c_void},
    ptr,
    sync::{Arc, atomic::Ordering},
};

use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use serde_json::json;

use crate::{
    TransferId, body::SharedTransfer, command::RequestData, engine::EventListener,
    error::NativeError, ffi, fingerprint,
};

const ERROR_BUFFER_SIZE: usize = 256;

pub struct Transfer {
    pub id: TransferId,
    pub easy: *mut ffi::CURL,
    request_url: String,
    listener: EventListener,
    shared: Arc<SharedTransfer>,
    body: Option<Vec<u8>>,
    header_list: *mut ffi::curl_slist,
    error_buffer: [c_char; ERROR_BUFFER_SIZE],
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    headers_emitted: bool,
    redirect_mode: String,
    callback_error: Option<NativeError>,
}

impl Transfer {
    pub fn new(
        id: TransferId,
        mut request: RequestData,
        listener: EventListener,
        shared: Arc<SharedTransfer>,
    ) -> Result<Box<Self>, NativeError> {
        let easy = unsafe { ffi::curl_easy_init() };
        if easy.is_null() {
            return Err(NativeError::Internal {
                message: "curl_easy_init returned null".to_owned(),
            });
        }

        let body = request.body.take();
        let mut transfer = Box::new(Self {
            id,
            easy,
            request_url: request.url.clone(),
            listener,
            shared,
            body,
            header_list: ptr::null_mut(),
            error_buffer: [0; ERROR_BUFFER_SIZE],
            status: 0,
            status_text: String::new(),
            headers: Vec::new(),
            headers_emitted: false,
            redirect_mode: request.redirect.clone(),
            callback_error: None,
        });
        transfer.configure(&request)?;
        Ok(transfer)
    }

    pub fn complete(&mut self, result: ffi::CURLcode) {
        if let Some(error) = self.callback_error.take() {
            self.send_error(error);
            self.shared.complete.store(true, Ordering::Release);
            return;
        }
        if result == ffi::CURLE_OK {
            if let Err(error) = self.emit_headers() {
                self.send_error(error);
                self.shared.complete.store(true, Ordering::Release);
                return;
            }
            self.shared.complete.store(true, Ordering::Release);
            self.send(json!({ "type": "complete", "transferId": self.id.to_string() }));
        } else {
            self.send_error(curl_easy_error(result, self.error_message(result)));
            self.shared.complete.store(true, Ordering::Release);
        }
    }

    pub fn cancel(&mut self) {
        self.shared.complete.store(true, Ordering::Release);
        self.send_error(NativeError::Cancelled);
    }

    pub fn fail(&mut self, error: &NativeError) {
        self.shared.complete.store(true, Ordering::Release);
        self.send(json!({
            "type": "error",
            "transferId": self.id.to_string(),
            "error": error.serializable(),
        }));
    }

    fn configure(&mut self, request: &RequestData) -> Result<(), NativeError> {
        let error_buffer = self.error_buffer.as_mut_ptr().cast();
        self.set_pointer(ffi::CURLOPT_ERRORBUFFER, error_buffer)?;
        self.set_long(ffi::CURLOPT_NOSIGNAL, 1)?;
        self.set_string(ffi::CURLOPT_URL, &request.url)?;
        self.set_string(ffi::CURLOPT_ACCEPT_ENCODING, "")?;
        self.set_long(ffi::CURLOPT_MAXREDIRS, 20)?;
        self.set_long(
            ffi::CURLOPT_FOLLOWLOCATION,
            i64::from(request.redirect == "follow"),
        )?;
        self.set_long(ffi::CURLOPT_SUPPRESS_CONNECT_HEADERS, 1)?;

        if let Some(target) = request.options.impersonate.as_deref() {
            let target = c_string(resolve_impersonate_target(target), "impersonate")?;
            let default_headers = request.options.default_headers.unwrap_or(true);
            check_easy(unsafe {
                ffi::curl_easy_impersonate(self.easy, target.as_ptr(), i32::from(default_headers))
            })?;
        }

        if let Some(proxy) = request.options.proxy.as_deref() {
            self.set_string(ffi::CURLOPT_PROXY, proxy)?;
        }
        if let Some(timeout) = request.options.timeout_ms {
            self.set_long(
                ffi::CURLOPT_TIMEOUT_MS,
                timeout_as_long(timeout, "timeout")?,
            )?;
        }
        if let Some(timeout) = request.options.connect_timeout_ms {
            self.set_long(
                ffi::CURLOPT_CONNECTTIMEOUT_MS,
                timeout_as_long(timeout, "connectTimeout")?,
            )?;
        }
        if let Some(version) = request.options.http_version.as_deref() {
            let value = match version {
                "auto" => ffi::CURL_HTTP_VERSION_NONE,
                "1.1" => ffi::CURL_HTTP_VERSION_1_1,
                "2" => ffi::CURL_HTTP_VERSION_2_0,
                "3" => ffi::CURL_HTTP_VERSION_3,
                _ => {
                    return Err(NativeError::InvalidArgument {
                        message: format!("unsupported HTTP version: {version}"),
                    });
                }
            };
            self.set_long(ffi::CURLOPT_HTTP_VERSION, value.into())?;
        }

        fingerprint::apply(self.easy, &request.options)?;

        match request.method.as_str() {
            "GET" => {}
            "HEAD" => self.set_long(ffi::CURLOPT_NOBODY, 1)?,
            "POST" => self.set_long(ffi::CURLOPT_POST, 1)?,
            method => self.set_string(ffi::CURLOPT_CUSTOMREQUEST, method)?,
        }

        if let Some(body) = self.body.as_ref() {
            check_easy(unsafe {
                ffi::fi_easy_setopt_pointer(
                    self.easy,
                    ffi::CURLOPT_POSTFIELDS,
                    body.as_ptr().cast_mut().cast(),
                )
            })?;
            self.set_long(
                ffi::CURLOPT_POSTFIELDSIZE,
                body.len()
                    .try_into()
                    .map_err(|_| NativeError::InvalidArgument {
                        message: "request body is too large".to_owned(),
                    })?,
            )?;
        }

        for (name, value) in &request.headers {
            let header = c_string(&format!("{name}: {value}"), "header")?;
            let appended = unsafe { ffi::curl_slist_append(self.header_list, header.as_ptr()) };
            if appended.is_null() {
                return Err(NativeError::Internal {
                    message: "curl_slist_append ran out of memory".to_owned(),
                });
            }
            self.header_list = appended;
        }
        if !self.header_list.is_null() {
            check_easy(unsafe {
                ffi::fi_easy_setopt_slist(self.easy, ffi::CURLOPT_HTTPHEADER, self.header_list)
            })?;
        }

        check_easy(unsafe { ffi::fi_easy_setopt_write_callback(self.easy, Some(write_callback)) })?;
        check_easy(unsafe {
            ffi::fi_easy_setopt_header_callback(self.easy, Some(header_callback))
        })?;
        let data = (self as *mut Self).cast::<c_void>();
        self.set_pointer(ffi::CURLOPT_WRITEDATA, data)?;
        self.set_pointer(ffi::CURLOPT_HEADERDATA, data)?;
        Ok(())
    }

    fn emit_headers(&mut self) -> Result<(), NativeError> {
        if self.headers_emitted {
            return Ok(());
        }
        if self.status == 0 {
            let mut status: c_long = 0;
            check_easy(unsafe {
                ffi::fi_easy_getinfo_long(self.easy, ffi::CURLINFO_RESPONSE_CODE, &mut status)
            })?;
            self.status = status.try_into().unwrap_or(0);
        }
        if self.status == 0 {
            return Ok(());
        }

        let url = self.effective_url()?;
        let mut redirect_count: c_long = 0;
        check_easy(unsafe {
            ffi::fi_easy_getinfo_long(self.easy, ffi::CURLINFO_REDIRECT_COUNT, &mut redirect_count)
        })?;
        self.send(json!({
            "type": "headers",
            "transferId": self.id.to_string(),
            "status": self.status,
            "statusText": self.status_text,
            "headers": self.headers,
            "url": url,
            "redirected": redirect_count > 0,
        }));
        self.headers_emitted = true;
        Ok(())
    }

    fn effective_url(&self) -> Result<String, NativeError> {
        let mut value: *mut c_char = ptr::null_mut();
        check_easy(unsafe {
            ffi::fi_easy_getinfo_string(self.easy, ffi::CURLINFO_EFFECTIVE_URL, &mut value)
        })?;
        if value.is_null() {
            return Ok(self.request_url.clone());
        }
        Ok(unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .into_owned())
    }

    fn set_long(&self, option: ffi::CURLoption, value: i64) -> Result<(), NativeError> {
        let value: c_long = value.try_into().map_err(|_| NativeError::InvalidArgument {
            message: format!("curl option {option} is out of range"),
        })?;
        check_easy(unsafe { ffi::fi_easy_setopt_long(self.easy, option, value) })
    }

    fn set_string(&self, option: ffi::CURLoption, value: &str) -> Result<(), NativeError> {
        let value = c_string(value, "curl option")?;
        check_easy(unsafe { ffi::fi_easy_setopt_string(self.easy, option, value.as_ptr()) })
    }

    fn set_pointer(&self, option: ffi::CURLoption, value: *mut c_void) -> Result<(), NativeError> {
        check_easy(unsafe { ffi::fi_easy_setopt_pointer(self.easy, option, value) })
    }

    fn send_error(&self, error: NativeError) {
        self.send(json!({
            "type": "error",
            "transferId": self.id.to_string(),
            "error": error.serializable(),
        }));
    }

    fn send(&self, event: serde_json::Value) {
        let _ = self.listener.call(
            (event.to_string(),),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }

    fn error_message(&self, code: ffi::CURLcode) -> String {
        if self.error_buffer[0] != 0 {
            return unsafe { CStr::from_ptr(self.error_buffer.as_ptr()) }
                .to_string_lossy()
                .into_owned();
        }
        unsafe { CStr::from_ptr(ffi::curl_easy_strerror(code)) }
            .to_string_lossy()
            .into_owned()
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        unsafe {
            if !self.header_list.is_null() {
                ffi::curl_slist_free_all(self.header_list);
            }
            if !self.easy.is_null() {
                ffi::curl_easy_cleanup(self.easy);
            }
        }
    }
}

unsafe extern "C" fn write_callback(
    data: *mut c_char,
    size: usize,
    count: usize,
    user_data: *mut c_void,
) -> usize {
    let Some(length) = size.checked_mul(count) else {
        return 0;
    };
    if user_data.is_null() {
        return 0;
    }
    let transfer = unsafe { &mut *user_data.cast::<Transfer>() };
    if transfer.emit_headers().is_err() {
        return 0;
    }
    let chunk = unsafe { std::slice::from_raw_parts(data.cast::<u8>(), length) };
    if !transfer.shared.try_push(chunk) {
        return ffi::CURL_WRITEFUNC_PAUSE;
    }
    transfer.send(json!({ "type": "body", "transferId": transfer.id.to_string() }));
    length
}

unsafe extern "C" fn header_callback(
    data: *mut c_char,
    size: usize,
    count: usize,
    user_data: *mut c_void,
) -> usize {
    let Some(length) = size.checked_mul(count) else {
        return 0;
    };
    if user_data.is_null() {
        return 0;
    }
    let transfer = unsafe { &mut *user_data.cast::<Transfer>() };
    let line = unsafe { std::slice::from_raw_parts(data.cast::<u8>(), length) };
    match transfer.accept_header_line(line) {
        Ok(()) => length,
        Err(_) => 0,
    }
}

impl Transfer {
    fn accept_header_line(&mut self, raw: &[u8]) -> Result<(), NativeError> {
        let line = String::from_utf8_lossy(raw)
            .trim_end_matches(['\r', '\n'])
            .to_owned();
        if line.starts_with("HTTP/") {
            let mut parts = line.splitn(3, ' ');
            let _protocol = parts.next();
            self.status = parts
                .next()
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
            self.status_text = parts.next().unwrap_or_default().to_owned();
            self.headers.clear();
            self.headers_emitted = false;
        } else if line.is_empty() {
            let is_intermediate = (100..200).contains(&self.status);
            let has_redirect_location = (300..400).contains(&self.status)
                && self
                    .headers
                    .iter()
                    .any(|(name, _)| name.eq_ignore_ascii_case("location"));
            if self.redirect_mode == "error" && has_redirect_location {
                self.callback_error = Some(NativeError::Fetch {
                    code: "FETCH_REDIRECT_ERROR".to_owned(),
                    message: "redirect mode is set to error".to_owned(),
                });
                return Err(NativeError::Fetch {
                    code: "FETCH_REDIRECT_ERROR".to_owned(),
                    message: "redirect mode is set to error".to_owned(),
                });
            }
            let is_followed_redirect = self.redirect_mode == "follow" && has_redirect_location;
            if !is_intermediate && !is_followed_redirect {
                self.emit_headers()?;
            }
        } else if !line.is_empty()
            && let Some((name, value)) = line.split_once(':')
        {
            self.headers
                .push((name.trim().to_owned(), value.trim().to_owned()));
        }
        Ok(())
    }
}

fn c_string(value: &str, name: &str) -> Result<CString, NativeError> {
    CString::new(value).map_err(|_| NativeError::InvalidArgument {
        message: format!("{name} contains a null byte"),
    })
}

fn timeout_as_long(value: u64, name: &str) -> Result<i64, NativeError> {
    i64::try_from(value).map_err(|_| NativeError::InvalidArgument {
        message: format!("{name} is too large"),
    })
}

fn resolve_impersonate_target(target: &str) -> &str {
    match target {
        "chrome" => "chrome146",
        "edge" => "edge101",
        "safari" | "safari_beta" => "safari2601",
        "safari_ios" | "safari_ios_beta" => "safari260_ios",
        "chrome_android" => "chrome131_android",
        "firefox" => "firefox147",
        "tor" => "tor145",
        _ => target,
    }
}

pub fn check_easy(code: ffi::CURLcode) -> Result<(), NativeError> {
    if code == ffi::CURLE_OK {
        Ok(())
    } else {
        Err(curl_easy_error(code, unsafe {
            CStr::from_ptr(ffi::curl_easy_strerror(code))
                .to_string_lossy()
                .into_owned()
        }))
    }
}

fn curl_easy_error(code: ffi::CURLcode, message: String) -> NativeError {
    NativeError::CurlEasy {
        code,
        name: curl_easy_code_name(code).to_owned(),
        message,
    }
}

fn curl_easy_code_name(code: ffi::CURLcode) -> &'static str {
    match code {
        3 => "CURLE_URL_MALFORMAT",
        5 => "CURLE_COULDNT_RESOLVE_PROXY",
        6 => "CURLE_COULDNT_RESOLVE_HOST",
        7 => "CURLE_COULDNT_CONNECT",
        16 => "CURLE_HTTP2",
        18 => "CURLE_PARTIAL_FILE",
        23 => "CURLE_WRITE_ERROR",
        28 => "CURLE_OPERATION_TIMEDOUT",
        35 => "CURLE_SSL_CONNECT_ERROR",
        42 => "CURLE_ABORTED_BY_CALLBACK",
        47 => "CURLE_TOO_MANY_REDIRECTS",
        52 => "CURLE_GOT_NOTHING",
        55 => "CURLE_SEND_ERROR",
        56 => "CURLE_RECV_ERROR",
        60 => "CURLE_PEER_FAILED_VERIFICATION",
        92 => "CURLE_HTTP2_STREAM",
        95 => "CURLE_HTTP3",
        96 => "CURLE_QUIC_CONNECT_ERROR",
        _ => "CURLE_UNKNOWN",
    }
}
