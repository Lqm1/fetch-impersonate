use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::TransferId;

pub const BODY_QUEUE_HIGH_WATER_MARK: usize = 1024 * 1024;
pub const BODY_QUEUE_LOW_WATER_MARK: usize = BODY_QUEUE_HIGH_WATER_MARK / 2;

#[derive(Default)]
struct BodyQueue {
    chunks: VecDeque<Vec<u8>>,
    bytes: usize,
}

#[derive(Default)]
pub struct SharedTransfer {
    body: Mutex<BodyQueue>,
    pub paused: AtomicBool,
    pub complete: AtomicBool,
}

impl SharedTransfer {
    pub fn try_push(&self, chunk: &[u8]) -> bool {
        let mut body = self.body.lock().expect("body queue mutex poisoned");
        if body.bytes + chunk.len() > BODY_QUEUE_HIGH_WATER_MARK {
            self.paused.store(true, Ordering::Release);
            return false;
        }
        body.bytes += chunk.len();
        body.chunks.push_back(chunk.to_vec());
        true
    }

    pub fn pop(&self) -> Option<Vec<u8>> {
        let mut body = self.body.lock().expect("body queue mutex poisoned");
        let chunk = body.chunks.pop_front()?;
        body.bytes -= chunk.len();
        Some(chunk)
    }

    pub fn should_resume(&self) -> bool {
        let body = self.body.lock().expect("body queue mutex poisoned");
        body.bytes <= BODY_QUEUE_LOW_WATER_MARK && self.paused.swap(false, Ordering::AcqRel)
    }

    pub fn is_empty(&self) -> bool {
        self.body
            .lock()
            .expect("body queue mutex poisoned")
            .chunks
            .is_empty()
    }
}

#[derive(Default)]
pub struct BodyRegistry {
    transfers: Mutex<HashMap<TransferId, Arc<SharedTransfer>>>,
}

impl BodyRegistry {
    pub fn insert(&self, id: TransferId, transfer: Arc<SharedTransfer>) {
        self.transfers
            .lock()
            .expect("body registry mutex poisoned")
            .insert(id, transfer);
    }

    pub fn get(&self, id: TransferId) -> Option<Arc<SharedTransfer>> {
        self.transfers
            .lock()
            .expect("body registry mutex poisoned")
            .get(&id)
            .cloned()
    }

    pub fn remove(&self, id: TransferId) {
        self.transfers
            .lock()
            .expect("body registry mutex poisoned")
            .remove(&id);
    }
}
