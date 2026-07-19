use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NativeError {
    #[error("{message}")]
    InvalidArgument { message: String },
    #[error("{message}")]
    CurlEasy {
        code: i32,
        name: String,
        message: String,
    },
    #[error("{message}")]
    CurlMulti {
        code: i32,
        name: String,
        message: String,
    },
    #[error("{message}")]
    Fetch { code: String, message: String },
    #[error("request was cancelled")]
    Cancelled,
    #[error("{message}")]
    Internal { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializableError<'a> {
    pub kind: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub curl_code: Option<i32>,
}

impl NativeError {
    pub fn serializable(&self) -> SerializableError<'_> {
        match self {
            Self::InvalidArgument { message } => SerializableError {
                kind: "invalidArgument",
                message: message.clone(),
                code: None,
                curl_code: None,
            },
            Self::CurlEasy {
                code,
                name,
                message,
            } => SerializableError {
                kind: "curlEasy",
                message: message.clone(),
                code: Some(name),
                curl_code: Some(*code),
            },
            Self::CurlMulti {
                code,
                name,
                message,
            } => SerializableError {
                kind: "curlMulti",
                message: message.clone(),
                code: Some(name),
                curl_code: Some(*code),
            },
            Self::Fetch { code, message } => SerializableError {
                kind: "fetch",
                message: message.clone(),
                code: Some(code),
                curl_code: None,
            },
            Self::Cancelled => SerializableError {
                kind: "cancelled",
                message: self.to_string(),
                code: None,
                curl_code: None,
            },
            Self::Internal { message } => SerializableError {
                kind: "internal",
                message: message.clone(),
                code: None,
                curl_code: None,
            },
        }
    }
}

impl From<NativeError> for napi::Error {
    fn from(error: NativeError) -> Self {
        let status = match &error {
            NativeError::InvalidArgument { .. } => napi::Status::InvalidArg,
            _ => napi::Status::GenericFailure,
        };
        napi::Error::new(status, error.to_string())
    }
}
