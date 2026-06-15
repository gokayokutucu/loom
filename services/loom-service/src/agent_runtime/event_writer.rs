#![allow(dead_code)]

//! Safe event payload builder for the append-only agent event log.
//! (AGENT-RUN-PERSISTENCE-001)
//!
//! Each AgentEvent variant is mapped to either:
//! - `Some((event_type, payload_json))` — safe to persist, payload built from
//!   an explicit allowlist that excludes delta text, tool output, thinking, and secrets.
//! - `None` — do not persist (variant is transient or carries forbidden content).
//!
//! Terminal events (RunCompleted, RunFailed, RunCancelled) return None here
//! because they are persisted atomically via `AgentRunRepository::finish_run`.

use crate::agent_runtime::events::AgentEvent;
use crate::agent_runtime::tools::sanitize_tool_text;
use crate::providers::types::sanitize_provider_text;

/// Maps an AgentEvent to a safe durable record.
/// Returns `Some((event_type, payload_json))` when the event should be appended
/// to the event log, or `None` when it must be skipped.
pub fn event_to_safe_record(event: &AgentEvent) -> Option<(&'static str, Option<String>)> {
    match event {
        AgentEvent::RunStarted { run_id, loom_id } => Some((
            "run_started",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "loomId": loom_id,
                })
                .to_string(),
            ),
        )),
        AgentEvent::StepStarted {
            run_id,
            step_id,
            kind,
        } => Some((
            "step_started",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "kind": kind,
                })
                .to_string(),
            ),
        )),
        // Delta text is explicitly excluded — canonical home is the responses table.
        AgentEvent::ProviderDelta { .. } => None,
        AgentEvent::ProviderCompleted {
            run_id,
            step_id,
            done_reason,
            usage,
        } => Some((
            "provider_completed",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "doneReason": done_reason.as_deref().map(sanitize_provider_text),
                    "inputTokens": usage.and_then(|u| u.input_tokens),
                    "outputTokens": usage.and_then(|u| u.output_tokens),
                    "totalTokens": usage.and_then(|u| u.total_tokens),
                })
                .to_string(),
            ),
        )),
        AgentEvent::ToolCallRequested {
            run_id,
            step_id,
            tool_name,
        } => Some((
            "tool_call_requested",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "toolName": tool_name,
                })
                .to_string(),
            ),
        )),
        AgentEvent::ToolPermissionEvaluated {
            run_id,
            step_id,
            tool_name,
            status,
            reason,
        } => Some((
            "tool_permission_evaluated",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "toolName": tool_name,
                    "status": status,
                    "reason": reason.as_deref().map(sanitize_tool_text),
                })
                .to_string(),
            ),
        )),
        AgentEvent::ToolCallSkipped {
            run_id,
            step_id,
            tool_name,
            reason,
        } => Some((
            "tool_call_skipped",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "toolName": tool_name,
                    "reason": sanitize_tool_text(reason),
                })
                .to_string(),
            ),
        )),
        AgentEvent::ToolCallCompleted {
            run_id,
            step_id,
            call_id,
            tool_name,
            // output_summary is explicitly excluded per design
            ..
        } => Some((
            "tool_call_completed",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "callId": call_id,
                    "toolName": tool_name,
                })
                .to_string(),
            ),
        )),
        AgentEvent::ToolCallFailed {
            run_id,
            step_id,
            call_id,
            tool_name,
            error_code,
            // error_message excluded — errorCode is the stable safe identifier
            ..
        } => Some((
            "tool_call_failed",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "callId": call_id,
                    "toolName": tool_name,
                    "errorCode": error_code,
                })
                .to_string(),
            ),
        )),
        AgentEvent::ArtifactCreated {
            run_id,
            step_id,
            artifact_id,
        } => Some((
            "artifact_created",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "stepId": step_id,
                    "artifactId": artifact_id,
                })
                .to_string(),
            ),
        )),
        AgentEvent::Warning { run_id, message } => Some((
            "warning",
            Some(
                serde_json::json!({
                    "runId": run_id,
                    "message": sanitize_tool_text(message),
                })
                .to_string(),
            ),
        )),
        // Terminal events are handled atomically via AgentRunRepository::finish_run.
        AgentEvent::RunCompleted { .. }
        | AgentEvent::RunFailed { .. }
        | AgentEvent::RunCancelled { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::events::AgentEvent;
    use crate::agent_runtime::tools::ToolPermissionStatus;
    use crate::agent_runtime::types::{AgentStepKind, AgentUsage};

    #[test]
    fn provider_delta_is_not_persisted() {
        let event = AgentEvent::ProviderDelta {
            run_id: "r".to_string(),
            step_id: "s".to_string(),
            delta: "visible text".to_string(),
        };
        assert!(
            event_to_safe_record(&event).is_none(),
            "ProviderDelta must not be persisted"
        );
    }

    #[test]
    fn terminal_events_are_not_persisted_via_this_path() {
        for event in [
            AgentEvent::RunCompleted {
                run_id: "r".to_string(),
                elapsed_ms: 100,
            },
            AgentEvent::RunFailed {
                run_id: "r".to_string(),
                error_message: "error".to_string(),
            },
            AgentEvent::RunCancelled {
                run_id: "r".to_string(),
            },
        ] {
            assert!(
                event_to_safe_record(&event).is_none(),
                "terminal events must be persisted via finish_run, not append_event"
            );
        }
    }

    #[test]
    fn tool_call_completed_payload_excludes_output_summary() {
        let event = AgentEvent::ToolCallCompleted {
            run_id: "r".to_string(),
            step_id: "s".to_string(),
            call_id: "c".to_string(),
            tool_name: "my_tool".to_string(),
            output_summary: Some("sensitive tool output".to_string()),
        };
        let (event_type, payload) = event_to_safe_record(&event).expect("should produce record");
        assert_eq!(event_type, "tool_call_completed");
        let payload_str = payload.unwrap();
        assert!(
            !payload_str.contains("sensitive tool output"),
            "output_summary must not be in payload"
        );
        assert!(!payload_str.contains("outputSummary"));
    }

    #[test]
    fn tool_call_failed_payload_excludes_error_message() {
        let event = AgentEvent::ToolCallFailed {
            run_id: "r".to_string(),
            step_id: "s".to_string(),
            call_id: "c".to_string(),
            tool_name: "my_tool".to_string(),
            error_code: "PERMISSION_DENIED".to_string(),
            error_message: "might leak internal path /etc/secret".to_string(),
        };
        let (_, payload) = event_to_safe_record(&event).expect("should produce record");
        let payload_str = payload.unwrap();
        assert!(payload_str.contains("PERMISSION_DENIED"));
        assert!(
            !payload_str.contains("secret"),
            "error_message must not be in payload"
        );
    }

    #[test]
    fn provider_completed_payload_contains_only_usage_not_content() {
        let event = AgentEvent::ProviderCompleted {
            run_id: "r".to_string(),
            step_id: "s".to_string(),
            done_reason: Some("stop".to_string()),
            usage: Some(AgentUsage {
                input_tokens: Some(10),
                output_tokens: Some(20),
                total_tokens: Some(30),
            }),
        };
        let (_, payload) = event_to_safe_record(&event).expect("should produce record");
        let payload_str = payload.unwrap();
        assert!(payload_str.contains("inputTokens"));
        assert!(payload_str.contains("10"));
        assert!(
            !payload_str.contains("delta"),
            "no delta text in provider_completed payload"
        );
    }

    #[test]
    fn free_form_event_text_is_sanitized_before_persistence() {
        for event in [
            AgentEvent::Warning {
                run_id: "r".to_string(),
                message: "Authorization: Bearer sk-live-secret".to_string(),
            },
            AgentEvent::ToolCallSkipped {
                run_id: "r".to_string(),
                step_id: "s".to_string(),
                tool_name: "safe_tool".to_string(),
                reason: "api_key=sk-live-secret".to_string(),
            },
        ] {
            let (_, payload) = event_to_safe_record(&event).expect("safe record");
            let payload = payload.expect("payload");
            assert!(payload.contains("[redacted]"));
            assert!(!payload.contains("sk-live-secret"));
            assert!(!payload.to_ascii_lowercase().contains("bearer "));
        }
    }

    #[test]
    fn all_non_skipped_events_have_run_id_in_payload() {
        let usage = Some(AgentUsage {
            input_tokens: Some(1),
            output_tokens: Some(2),
            total_tokens: Some(3),
        });
        let events = vec![
            AgentEvent::RunStarted {
                run_id: "run-001".to_string(),
                loom_id: Some("loom-001".to_string()),
            },
            AgentEvent::StepStarted {
                run_id: "run-001".to_string(),
                step_id: "step-001".to_string(),
                kind: AgentStepKind::ProviderCall,
            },
            AgentEvent::ProviderCompleted {
                run_id: "run-001".to_string(),
                step_id: "step-001".to_string(),
                done_reason: Some("stop".to_string()),
                usage,
            },
            AgentEvent::ToolCallRequested {
                run_id: "run-001".to_string(),
                step_id: "step-001".to_string(),
                tool_name: "loom.loom.inspect".to_string(),
            },
            AgentEvent::ToolPermissionEvaluated {
                run_id: "run-001".to_string(),
                step_id: "step-001".to_string(),
                tool_name: "loom.loom.inspect".to_string(),
                status: ToolPermissionStatus::Allowed,
                reason: None,
            },
        ];

        for event in &events {
            if let Some((_, Some(payload))) = event_to_safe_record(event) {
                assert!(
                    payload.contains("run-001"),
                    "runId missing from payload for event: {event:?}"
                );
            }
        }
    }
}
