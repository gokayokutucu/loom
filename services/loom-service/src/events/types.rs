use serde::Serialize;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

/// Privacy boundary:
/// raw model thinking/internal monologue must never be emitted, persisted, or
/// placed into future context by loom-service. Future thinking-related events
/// may expose only duration, status, and stalled flags.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomServiceEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub timestamp: String,
    pub correlation_id: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub payload: serde_json::Value,
}

pub fn runtime_health_event(id: String, status: &str) -> LoomServiceEvent {
    service_event(id, "runtime.health", json!({ "status": status }))
}

pub fn service_event(
    id: String,
    event_type: impl Into<String>,
    payload: serde_json::Value,
) -> LoomServiceEvent {
    LoomServiceEvent {
        correlation_id: id.clone(),
        id,
        event_type: event_type.into(),
        timestamp: unix_timestamp_millis(),
        loom_id: None,
        response_id: None,
        payload,
    }
}

fn unix_timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::runtime_health_event;

    #[test]
    fn runtime_health_event_is_json_compatible_without_raw_thinking() {
        let event = runtime_health_event("test".to_string(), "ready");
        let value = serde_json::to_value(event).expect("event should serialize");

        assert_eq!(value["type"], "runtime.health");
        assert_eq!(value["payload"]["status"], "ready");
        assert!(value.get("thinkingText").is_none());
        assert!(value.get("rawThinking").is_none());
    }
}
