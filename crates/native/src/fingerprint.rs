#![allow(clippy::useless_conversion)] // c_long is i32 on Windows and i64 on Unix.

use std::{collections::HashSet, ffi::CString, os::raw::c_long};

use serde::Deserialize;

use crate::{command::RequestOptions, error::NativeError, ffi};

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct ExtraFingerprints {
    tls_min_version: String,
    tls_grease: bool,
    tls_permute_extensions: bool,
    tls_cert_compression: String,
    tls_signature_algorithms: Option<Vec<String>>,
    tls_delegated_credential: String,
    tls_record_size_limit: u32,
    http2_stream_weight: u16,
    http2_stream_exclusive: bool,
    http2_no_priority: bool,
    split_cookies: Option<bool>,
    form_boundary: Option<String>,
    http3_sig_hash_algs: Option<String>,
    http3_tls_extension_order: Option<String>,
}

impl Default for ExtraFingerprints {
    fn default() -> Self {
        Self {
            tls_min_version: "1.2".to_owned(),
            tls_grease: false,
            tls_permute_extensions: false,
            tls_cert_compression: "brotli".to_owned(),
            tls_signature_algorithms: None,
            tls_delegated_credential: String::new(),
            tls_record_size_limit: 0,
            http2_stream_weight: 256,
            http2_stream_exclusive: true,
            http2_no_priority: false,
            split_cookies: None,
            form_boundary: None,
            http3_sig_hash_algs: None,
            http3_tls_extension_order: None,
        }
    }
}

pub fn apply(easy: *mut ffi::CURL, options: &RequestOptions) -> Result<(), NativeError> {
    let extra = options
        .extra_fp
        .as_deref()
        .map(parse_extra_fingerprints)
        .transpose()?;

    if let Some(ja3) = options.ja3.as_deref() {
        set_ja3_options(
            easy,
            ja3,
            extra
                .as_ref()
                .is_some_and(|fingerprint| fingerprint.tls_permute_extensions),
        )?;
    }
    if let Some(extra) = extra.as_ref() {
        set_extra_fingerprints(easy, extra)?;
    }
    if let Some(akamai) = options.akamai.as_deref() {
        set_akamai_options(easy, akamai)?;
    }

    Ok(())
}

fn parse_extra_fingerprints(value: &str) -> Result<ExtraFingerprints, NativeError> {
    serde_json::from_str(value).map_err(|error| invalid(format!("invalid extraFp: {error}")))
}

fn set_ja3_options(easy: *mut ffi::CURL, ja3: &str, permute: bool) -> Result<(), NativeError> {
    let sections = ja3.split(',').collect::<Vec<_>>();
    if sections.len() != 5 {
        return Err(invalid(
            "ja3 must contain exactly five comma-separated sections",
        ));
    }

    let tls_version = parse_u32(sections[0], "JA3 TLS version")?;
    if tls_version != 771 {
        return Err(invalid("only TLS 1.2 (771) is supported in JA3"));
    }
    set_long(
        easy,
        ffi::CURLOPT_SSLVERSION,
        (ffi::CURL_SSLVERSION_TLSV1_2 | ffi::CURL_SSLVERSION_MAX_DEFAULT).into(),
    )?;

    let cipher_names = parse_dash_numbers(sections[1], "JA3 cipher")?
        .into_iter()
        .map(|cipher| {
            cipher_name(cipher)
                .map(str::to_owned)
                .ok_or_else(|| invalid(format!("JA3 cipher {cipher:#06x} is not supported")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    set_string(easy, ffi::CURLOPT_SSL_CIPHER_LIST, &cipher_names.join(":"))?;

    let extensions = sections[2].strip_suffix("-21").unwrap_or(sections[2]);
    let extension_ids = parse_dash_numbers(extensions, "JA3 extension")?
        .into_iter()
        .collect::<HashSet<_>>();
    toggle_extensions(easy, &extension_ids)?;
    if !permute {
        set_string(easy, ffi::CURLOPT_TLS_EXTENSION_ORDER, extensions)?;
    }

    let curve_names = parse_dash_numbers(sections[3], "JA3 curve")?
        .into_iter()
        .map(|curve| {
            curve_name(curve)
                .map(str::to_owned)
                .ok_or_else(|| invalid(format!("JA3 curve {curve} is not supported")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    set_string(easy, ffi::CURLOPT_SSL_EC_CURVES, &curve_names.join(":"))?;

    if parse_u32(sections[4], "JA3 curve format")? != 0 {
        return Err(invalid("only JA3 curve format 0 is supported"));
    }
    Ok(())
}

fn toggle_extensions(
    easy: *mut ffi::CURL,
    extension_ids: &HashSet<u32>,
) -> Result<(), NativeError> {
    const DEFAULT_ENABLED: [u32; 11] = [0, 10, 11, 13, 16, 23, 35, 43, 45, 51, 65281];
    let defaults = DEFAULT_ENABLED.into_iter().collect::<HashSet<_>>();

    for extension in extension_ids.difference(&defaults) {
        toggle_extension(easy, *extension, true)?;
    }
    for extension in defaults.difference(extension_ids) {
        toggle_extension(easy, *extension, false)?;
    }
    Ok(())
}

fn toggle_extension(
    easy: *mut ffi::CURL,
    extension: u32,
    enabled: bool,
) -> Result<(), NativeError> {
    let flag = i64::from(enabled);
    match extension {
        65037 => set_string(easy, ffi::CURLOPT_ECH, if enabled { "grease" } else { "" }),
        27 => set_string(
            easy,
            ffi::CURLOPT_SSL_CERT_COMPRESSION,
            if enabled { "brotli" } else { "" },
        ),
        17513 => set_long(easy, ffi::CURLOPT_SSL_ENABLE_ALPS, flag),
        17613 => {
            set_long(easy, ffi::CURLOPT_SSL_ENABLE_ALPS, flag)?;
            set_long(easy, ffi::CURLOPT_TLS_USE_NEW_ALPS_CODEPOINT, flag)
        }
        16 => set_long(easy, ffi::CURLOPT_SSL_ENABLE_ALPN, flag),
        5 if enabled => set_long(easy, ffi::CURLOPT_TLS_STATUS_REQUEST, 1),
        18 if enabled => set_long(easy, ffi::CURLOPT_TLS_SIGNED_CERT_TIMESTAMPS, 1),
        35 => set_long(easy, ffi::CURLOPT_SSL_ENABLE_TICKET, flag),
        21 | 28 | 34 => Ok(()),
        0 => Err(invalid("JA3 cannot toggle the server_name extension (0)")),
        _ => Err(invalid(format!(
            "JA3 extension {extension} cannot be toggled by curl-impersonate"
        ))),
    }
}

fn set_akamai_options(easy: *mut ffi::CURL, akamai: &str) -> Result<(), NativeError> {
    let sections = akamai.split('|').collect::<Vec<_>>();
    if sections.len() != 4 {
        return Err(invalid(
            "akamai must contain exactly four pipe-separated sections",
        ));
    }
    let settings = sections[0].replace(',', ";");
    let window_update = parse_u32(sections[1], "Akamai window update")?;

    set_long(
        easy,
        ffi::CURLOPT_HTTP_VERSION,
        ffi::CURL_HTTP_VERSION_2_0.into(),
    )?;
    set_string(easy, ffi::CURLOPT_HTTP2_SETTINGS, &settings)?;
    set_long(
        easy,
        ffi::CURLOPT_HTTP2_WINDOW_UPDATE,
        i64::from(window_update),
    )?;
    if sections[2] != "0" {
        set_string(easy, ffi::CURLOPT_HTTP2_STREAMS, sections[2])?;
    }
    set_string(
        easy,
        ffi::CURLOPT_HTTP2_PSEUDO_HEADERS_ORDER,
        &sections[3].replace(',', ""),
    )
}

fn set_extra_fingerprints(
    easy: *mut ffi::CURL,
    fingerprint: &ExtraFingerprints,
) -> Result<(), NativeError> {
    if let Some(algorithms) = fingerprint.tls_signature_algorithms.as_ref() {
        set_string(easy, ffi::CURLOPT_SSL_SIG_HASH_ALGS, &algorithms.join(","))?;
    }
    let tls_version = match fingerprint.tls_min_version.as_str() {
        "1.0" => ffi::CURL_SSLVERSION_TLSV1_0,
        "1.1" => ffi::CURL_SSLVERSION_TLSV1_1,
        "1.2" => ffi::CURL_SSLVERSION_TLSV1_2,
        "1.3" => ffi::CURL_SSLVERSION_TLSV1_3,
        version => {
            return Err(invalid(format!(
                "unsupported extraFp.tlsMinVersion: {version}"
            )));
        }
    };
    if !matches!(fingerprint.tls_cert_compression.as_str(), "zlib" | "brotli") {
        return Err(invalid("extraFp.tlsCertCompression must be zlib or brotli"));
    }
    if !(1..=256).contains(&fingerprint.http2_stream_weight) {
        return Err(invalid(
            "extraFp.http2StreamWeight must be between 1 and 256",
        ));
    }

    set_long(
        easy,
        ffi::CURLOPT_SSLVERSION,
        (tls_version | ffi::CURL_SSLVERSION_MAX_DEFAULT).into(),
    )?;
    set_long(
        easy,
        ffi::CURLOPT_TLS_GREASE,
        i64::from(fingerprint.tls_grease),
    )?;
    set_long(
        easy,
        ffi::CURLOPT_SSL_PERMUTE_EXTENSIONS,
        i64::from(fingerprint.tls_permute_extensions),
    )?;
    set_string(
        easy,
        ffi::CURLOPT_SSL_CERT_COMPRESSION,
        &fingerprint.tls_cert_compression,
    )?;
    set_long(
        easy,
        ffi::CURLOPT_STREAM_WEIGHT,
        i64::from(fingerprint.http2_stream_weight),
    )?;
    set_long(
        easy,
        ffi::CURLOPT_STREAM_EXCLUSIVE,
        i64::from(fingerprint.http2_stream_exclusive),
    )?;
    if !fingerprint.tls_delegated_credential.is_empty() {
        set_string(
            easy,
            ffi::CURLOPT_TLS_DELEGATED_CREDENTIALS,
            &fingerprint.tls_delegated_credential,
        )?;
    }
    if fingerprint.tls_record_size_limit != 0 {
        set_long(
            easy,
            ffi::CURLOPT_TLS_RECORD_SIZE_LIMIT,
            i64::from(fingerprint.tls_record_size_limit),
        )?;
    }
    if fingerprint.http2_no_priority {
        set_long(easy, ffi::CURLOPT_HTTP2_NO_PRIORITY, 1)?;
    }
    if let Some(split_cookies) = fingerprint.split_cookies {
        set_long(easy, ffi::CURLOPT_SPLIT_COOKIES, i64::from(split_cookies))?;
    }
    if let Some(boundary) = fingerprint.form_boundary.as_deref() {
        set_string(easy, ffi::CURLOPT_FORM_BOUNDARY, boundary)?;
    }
    if let Some(algorithms) = fingerprint.http3_sig_hash_algs.as_deref() {
        set_string(easy, ffi::CURLOPT_HTTP3_SIG_HASH_ALGS, algorithms)?;
    }
    if let Some(order) = fingerprint.http3_tls_extension_order.as_deref() {
        set_string(easy, ffi::CURLOPT_HTTP3_TLS_EXTENSION_ORDER, order)?;
    }
    Ok(())
}

fn parse_dash_numbers(value: &str, name: &str) -> Result<Vec<u32>, NativeError> {
    if value.is_empty() {
        return Err(invalid(format!("{name} list must not be empty")));
    }
    value.split('-').map(|item| parse_u32(item, name)).collect()
}

fn parse_u32(value: &str, name: &str) -> Result<u32, NativeError> {
    value
        .parse()
        .map_err(|_| invalid(format!("{name} is not a valid unsigned integer: {value}")))
}

fn set_long(easy: *mut ffi::CURL, option: ffi::CURLoption, value: i64) -> Result<(), NativeError> {
    let value: c_long = value
        .try_into()
        .map_err(|_| invalid(format!("curl option {option} is out of range")))?;
    super::transfer::check_easy(unsafe { ffi::fi_easy_setopt_long(easy, option, value) })
}

fn set_string(
    easy: *mut ffi::CURL,
    option: ffi::CURLoption,
    value: &str,
) -> Result<(), NativeError> {
    let value =
        CString::new(value).map_err(|_| invalid("fingerprint option contains a null byte"))?;
    super::transfer::check_easy(unsafe { ffi::fi_easy_setopt_string(easy, option, value.as_ptr()) })
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::InvalidArgument {
        message: message.into(),
    }
}

fn cipher_name(cipher: u32) -> Option<&'static str> {
    Some(match cipher {
        0x000A => "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
        0x002F => "TLS_RSA_WITH_AES_128_CBC_SHA",
        0x0033 => "TLS_DHE_RSA_WITH_AES_128_CBC_SHA",
        0x0035 => "TLS_RSA_WITH_AES_256_CBC_SHA",
        0x0039 => "TLS_DHE_RSA_WITH_AES_256_CBC_SHA",
        0x003C => "TLS_RSA_WITH_AES_128_CBC_SHA256",
        0x003D => "TLS_RSA_WITH_AES_256_CBC_SHA256",
        0x0067 => "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256",
        0x006B => "TLS_DHE_RSA_WITH_AES_256_CBC_SHA256",
        0x008C => "TLS_PSK_WITH_AES_128_CBC_SHA",
        0x008D => "TLS_PSK_WITH_AES_256_CBC_SHA",
        0x009C => "TLS_RSA_WITH_AES_128_GCM_SHA256",
        0x009D => "TLS_RSA_WITH_AES_256_GCM_SHA384",
        0x009E => "TLS_DHE_RSA_WITH_AES_128_GCM_SHA256",
        0x009F => "TLS_DHE_RSA_WITH_AES_256_GCM_SHA384",
        0x1301 => "TLS_AES_128_GCM_SHA256",
        0x1302 => "TLS_AES_256_GCM_SHA384",
        0x1303 => "TLS_CHACHA20_POLY1305_SHA256",
        0xC008 => "TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA",
        0xC009 => "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
        0xC00A => "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
        0xC012 => "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA",
        0xC013 => "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
        0xC014 => "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
        0xC023 => "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
        0xC024 => "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384",
        0xC027 => "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
        0xC028 => "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384",
        0xC02B => "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
        0xC02C => "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
        0xC02F => "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
        0xC030 => "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
        0xC035 => "TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA",
        0xC036 => "TLS_ECDHE_PSK_WITH_AES_256_CBC_SHA",
        0xCCA8 => "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
        0xCCA9 => "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
        0xCCAC => "TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256",
        _ => return None,
    })
}

fn curve_name(curve: u32) -> Option<&'static str> {
    Some(match curve {
        19 => "P-192",
        21 => "P-224",
        23 => "P-256",
        24 => "P-384",
        25 => "P-521",
        29 => "X25519",
        256 => "ffdhe2048",
        257 => "ffdhe3072",
        4588 => "X25519MLKEM768",
        25497 => "X25519Kyber768Draft00",
        _ => return None,
    })
}
