#![deny(clippy::all)]
#![cfg_attr(feature = "native-stub", allow(dead_code))]
#![allow(clippy::useless_conversion)] // c_long differs between Windows and Unix.

use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[cfg(all(feature = "native-curl", feature = "native-stub"))]
compile_error!("native-curl and native-stub cannot be enabled together");
#[cfg(not(any(feature = "native-curl", feature = "native-stub")))]
compile_error!("enable native-curl or native-stub");

mod body;
mod command;
mod engine;
mod error;
#[cfg(feature = "native-curl")]
mod ffi;
#[cfg(feature = "native-curl")]
mod fingerprint;
#[cfg(feature = "native-curl")]
mod reactor;
#[cfg(feature = "native-curl")]
mod transfer;

use command::{RequestData, RequestOptions};
use engine::{EnvironmentEngine, RawEventListener, shared_engine};
use error::NativeError;

pub type TransferId = u64;
static NEXT_TRANSFER_ID: AtomicU64 = AtomicU64::new(1);

#[napi(object)]
pub struct NativeOptions {
    pub impersonate: Option<String>,
    pub default_headers: Option<bool>,
    pub proxy: Option<String>,
    pub timeout: Option<f64>,
    pub connect_timeout: Option<f64>,
    pub http_version: Option<String>,
    pub ja3: Option<String>,
    pub akamai: Option<String>,
    pub extra_fp: Option<String>,
}

#[napi(object)]
pub struct NativeRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<Vec<String>>,
    pub body: Option<Uint8Array>,
    pub redirect: String,
    pub options: NativeOptions,
}

#[napi(object)]
pub struct NativeVersionInfo {
    pub addon: String,
    pub curl: String,
    pub curl_impersonate: String,
}

#[napi]
pub fn start_request(
    env: Env,
    request: NativeRequest,
    listener: RawEventListener,
) -> napi::Result<BigInt> {
    let id = NEXT_TRANSFER_ID.fetch_add(1, Ordering::Relaxed);
    let request = normalize_request(request)?;
    shared_engine(&env)?.start(id, request, listener)?;
    Ok(BigInt::from(id))
}

#[napi]
pub fn read_body(env: Env, transfer_id: BigInt) -> napi::Result<Option<Buffer>> {
    let id = transfer_id_value(&transfer_id)?;
    Ok(shared_engine(&env)?.read_body(id).map(Buffer::from))
}

#[napi]
pub fn cancel_request(env: Env, transfer_id: BigInt) -> napi::Result<()> {
    let id = transfer_id_value(&transfer_id)?;
    shared_engine(&env)?.cancel(id);
    Ok(())
}

#[napi]
pub fn version(env: Env) -> napi::Result<NativeVersionInfo> {
    let (curl, curl_impersonate) = shared_engine(&env)?.version();
    Ok(NativeVersionInfo {
        addon: env!("CARGO_PKG_VERSION").to_owned(),
        curl,
        curl_impersonate,
    })
}

#[napi(module_exports)]
pub fn initialize(_exports: Object, env: Env) -> napi::Result<()> {
    let environment = Arc::new(EnvironmentEngine::default());
    env.set_instance_data(environment, (), |context| context.value.shutdown())
}

fn normalize_request(request: NativeRequest) -> std::result::Result<RequestData, NativeError> {
    let headers = request
        .headers
        .into_iter()
        .map(|header| {
            if header.len() != 2 {
                return Err(NativeError::InvalidArgument {
                    message: "each header must contain a name and value".to_owned(),
                });
            }
            Ok((header[0].clone(), header[1].clone()))
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(RequestData {
        url: request.url,
        method: request.method,
        headers,
        body: request.body.map(|body| body.to_vec()),
        redirect: request.redirect,
        options: RequestOptions {
            impersonate: request.options.impersonate,
            default_headers: request.options.default_headers,
            proxy: request.options.proxy,
            timeout_ms: optional_milliseconds(request.options.timeout, "timeout")?,
            connect_timeout_ms: optional_milliseconds(
                request.options.connect_timeout,
                "connectTimeout",
            )?,
            http_version: request.options.http_version,
            ja3: request.options.ja3,
            akamai: request.options.akamai,
            extra_fp: request.options.extra_fp,
        },
    })
}

fn optional_milliseconds(
    value: Option<f64>,
    name: &str,
) -> std::result::Result<Option<u64>, NativeError> {
    value
        .map(|value| {
            if !value.is_finite() || value < 0.0 || value > u64::MAX as f64 {
                return Err(NativeError::InvalidArgument {
                    message: format!("{name} must be a finite, non-negative number"),
                });
            }
            Ok(value.round() as u64)
        })
        .transpose()
}

fn transfer_id_value(value: &BigInt) -> napi::Result<u64> {
    let (signed, value, lossless) = value.get_u64();
    if signed || !lossless {
        return Err(napi::Error::new(
            napi::Status::InvalidArg,
            "invalid transfer id",
        ));
    }
    Ok(value)
}
