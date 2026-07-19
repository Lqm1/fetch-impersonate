/* automatically generated from curl-impersonate v2.0.0rc4 headers; do not edit */

use std::ffi::{c_char, c_int, c_long, c_void};

pub type CURLcode = c_int;
pub type CURLMcode = c_int;
pub type CURLINFO = c_int;
pub type CURLoption = c_int;

#[repr(C)]
pub struct CURL {
    _private: [u8; 0],
}
#[repr(C)]
pub struct CURLM {
    _private: [u8; 0],
}
#[repr(C)]
pub struct curl_slist {
    pub data: *mut c_char,
    pub next: *mut curl_slist,
}

pub const CURL_GLOBAL_ALL: c_long = 3;
pub const CURLE_OK: CURLcode = 0;
pub const CURLM_OK: CURLMcode = 0;
pub const CURLMSG_DONE: c_int = 1;
pub const CURL_WRITEFUNC_PAUSE: usize = 0x10000001;
pub const CURLPAUSE_CONT: c_int = 0;

pub const CURLOPT_WRITEDATA: CURLoption = 10001;
pub const CURLOPT_URL: CURLoption = 10002;
pub const CURLOPT_PROXY: CURLoption = 10004;
pub const CURLOPT_ERRORBUFFER: CURLoption = 10010;
pub const CURLOPT_POSTFIELDS: CURLoption = 10015;
pub const CURLOPT_HTTPHEADER: CURLoption = 10023;
pub const CURLOPT_HEADERDATA: CURLoption = 10029;
pub const CURLOPT_CUSTOMREQUEST: CURLoption = 10036;
pub const CURLOPT_NOBODY: CURLoption = 44;
pub const CURLOPT_POST: CURLoption = 47;
pub const CURLOPT_FOLLOWLOCATION: CURLoption = 52;
pub const CURLOPT_POSTFIELDSIZE: CURLoption = 60;
pub const CURLOPT_MAXREDIRS: CURLoption = 68;
pub const CURLOPT_HTTP_VERSION: CURLoption = 84;
pub const CURLOPT_NOSIGNAL: CURLoption = 99;
pub const CURLOPT_ACCEPT_ENCODING: CURLoption = 10102;
pub const CURLOPT_TIMEOUT_MS: CURLoption = 155;
pub const CURLOPT_CONNECTTIMEOUT_MS: CURLoption = 156;
pub const CURLOPT_STREAM_WEIGHT: CURLoption = 239;
pub const CURLOPT_SUPPRESS_CONNECT_HEADERS: CURLoption = 265;
pub const CURLOPT_SSLVERSION: CURLoption = 32;
pub const CURLOPT_SSL_ENABLE_ALPN: CURLoption = 226;
pub const CURLOPT_SSL_CIPHER_LIST: CURLoption = 10083;
pub const CURLOPT_SSL_EC_CURVES: CURLoption = 10298;
pub const CURLOPT_ECH: CURLoption = 10325;

pub const CURLOPT_SSL_SIG_HASH_ALGS: CURLoption = 11001;
pub const CURLOPT_SSL_ENABLE_ALPS: CURLoption = 1002;
pub const CURLOPT_SSL_CERT_COMPRESSION: CURLoption = 11003;
pub const CURLOPT_SSL_ENABLE_TICKET: CURLoption = 1004;
pub const CURLOPT_HTTP2_PSEUDO_HEADERS_ORDER: CURLoption = 11005;
pub const CURLOPT_HTTP2_SETTINGS: CURLoption = 11006;
pub const CURLOPT_SSL_PERMUTE_EXTENSIONS: CURLoption = 1007;
pub const CURLOPT_HTTP2_WINDOW_UPDATE: CURLoption = 1008;
pub const CURLOPT_HTTP2_STREAMS: CURLoption = 11010;
pub const CURLOPT_TLS_GREASE: CURLoption = 1011;
pub const CURLOPT_TLS_EXTENSION_ORDER: CURLoption = 11012;
pub const CURLOPT_STREAM_EXCLUSIVE: CURLoption = 1013;
pub const CURLOPT_TLS_SIGNED_CERT_TIMESTAMPS: CURLoption = 1015;
pub const CURLOPT_TLS_STATUS_REQUEST: CURLoption = 1016;
pub const CURLOPT_TLS_DELEGATED_CREDENTIALS: CURLoption = 11017;
pub const CURLOPT_TLS_RECORD_SIZE_LIMIT: CURLoption = 1018;
pub const CURLOPT_TLS_USE_NEW_ALPS_CODEPOINT: CURLoption = 1020;
pub const CURLOPT_HTTP2_NO_PRIORITY: CURLoption = 1021;
pub const CURLOPT_SPLIT_COOKIES: CURLoption = 1023;
pub const CURLOPT_FORM_BOUNDARY: CURLoption = 11024;
pub const CURLOPT_HTTP3_SIG_HASH_ALGS: CURLoption = 11028;
pub const CURLOPT_HTTP3_TLS_EXTENSION_ORDER: CURLoption = 11029;

pub const CURL_HTTP_VERSION_NONE: c_long = 0;
pub const CURL_HTTP_VERSION_1_1: c_long = 2;
pub const CURL_HTTP_VERSION_2_0: c_long = 3;
pub const CURL_HTTP_VERSION_3: c_long = 30;

pub const CURL_SSLVERSION_TLSV1_0: c_long = 4;
pub const CURL_SSLVERSION_TLSV1_1: c_long = 5;
pub const CURL_SSLVERSION_TLSV1_2: c_long = 6;
pub const CURL_SSLVERSION_TLSV1_3: c_long = 7;
pub const CURL_SSLVERSION_MAX_DEFAULT: c_long = 1 << 16;

pub const CURLINFO_EFFECTIVE_URL: CURLINFO = 0x100001;
pub const CURLINFO_RESPONSE_CODE: CURLINFO = 0x200002;
pub const CURLINFO_REDIRECT_COUNT: CURLINFO = 0x200014;

#[repr(C)]
pub union CURLMsgData {
    pub whatever: *mut c_void,
    pub result: CURLcode,
}

#[repr(C)]
pub struct CURLMsg {
    pub msg: c_int,
    pub easy_handle: *mut CURL,
    pub data: CURLMsgData,
}

pub type CurlWriteCallback =
    Option<unsafe extern "C" fn(*mut c_char, usize, usize, *mut c_void) -> usize>;

unsafe extern "C" {
    pub fn curl_global_init(flags: c_long) -> CURLcode;
    pub fn curl_global_cleanup();
    pub fn curl_version() -> *const c_char;
    pub fn curl_easy_init() -> *mut CURL;
    pub fn curl_easy_cleanup(curl: *mut CURL);
    pub fn curl_easy_pause(curl: *mut CURL, bitmask: c_int) -> CURLcode;
    pub fn curl_easy_strerror(code: CURLcode) -> *const c_char;
    pub fn curl_easy_impersonate(
        curl: *mut CURL,
        target: *const c_char,
        default_headers: c_int,
    ) -> CURLcode;
    pub fn curl_slist_append(list: *mut curl_slist, value: *const c_char) -> *mut curl_slist;
    pub fn curl_slist_free_all(list: *mut curl_slist);

    pub fn curl_multi_init() -> *mut CURLM;
    pub fn curl_multi_cleanup(multi: *mut CURLM) -> CURLMcode;
    pub fn curl_multi_add_handle(multi: *mut CURLM, easy: *mut CURL) -> CURLMcode;
    pub fn curl_multi_remove_handle(multi: *mut CURLM, easy: *mut CURL) -> CURLMcode;
    pub fn curl_multi_perform(multi: *mut CURLM, running_handles: *mut c_int) -> CURLMcode;
    pub fn curl_multi_poll(
        multi: *mut CURLM,
        extra_fds: *mut c_void,
        extra_nfds: u32,
        timeout_ms: c_int,
        numfds: *mut c_int,
    ) -> CURLMcode;
    pub fn curl_multi_info_read(multi: *mut CURLM, msgs_in_queue: *mut c_int) -> *mut CURLMsg;
    pub fn curl_multi_wakeup(multi: *mut CURLM) -> CURLMcode;
    pub fn curl_multi_strerror(code: CURLMcode) -> *const c_char;

    pub fn fi_easy_setopt_long(curl: *mut CURL, option: CURLoption, value: c_long) -> CURLcode;
    pub fn fi_easy_setopt_off_t(curl: *mut CURL, option: CURLoption, value: i64) -> CURLcode;
    pub fn fi_easy_setopt_string(
        curl: *mut CURL,
        option: CURLoption,
        value: *const c_char,
    ) -> CURLcode;
    pub fn fi_easy_setopt_pointer(
        curl: *mut CURL,
        option: CURLoption,
        value: *mut c_void,
    ) -> CURLcode;
    pub fn fi_easy_setopt_slist(
        curl: *mut CURL,
        option: CURLoption,
        value: *mut curl_slist,
    ) -> CURLcode;
    pub fn fi_easy_setopt_write_callback(curl: *mut CURL, callback: CurlWriteCallback) -> CURLcode;
    pub fn fi_easy_setopt_header_callback(curl: *mut CURL, callback: CurlWriteCallback)
    -> CURLcode;
    pub fn fi_easy_getinfo_long(curl: *mut CURL, info: CURLINFO, value: *mut c_long) -> CURLcode;
    pub fn fi_easy_getinfo_string(
        curl: *mut CURL,
        info: CURLINFO,
        value: *mut *mut c_char,
    ) -> CURLcode;
}
