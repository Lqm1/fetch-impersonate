use std::sync::Arc;

use crate::{TransferId, body::SharedTransfer, engine::EventListener};

#[derive(Debug)]
pub struct RequestOptions {
    pub impersonate: Option<String>,
    pub default_headers: Option<bool>,
    pub proxy: Option<String>,
    pub timeout_ms: Option<u64>,
    pub connect_timeout_ms: Option<u64>,
    pub http_version: Option<String>,
    pub ja3: Option<String>,
    pub akamai: Option<String>,
    pub extra_fp: Option<String>,
}

#[derive(Debug)]
pub struct RequestData {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub redirect: String,
    pub options: RequestOptions,
}

pub struct StartTransfer {
    pub id: TransferId,
    pub request: RequestData,
    pub listener: EventListener,
    pub shared: Arc<SharedTransfer>,
}

pub enum Command {
    Start(Box<StartTransfer>),
    Cancel(TransferId),
    ResumeDownload(TransferId),
    Shutdown,
}
