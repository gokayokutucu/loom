// Loom-native experimental Agent Runtime foundation.
// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: V2 Runtime
// migration_status: needs_bridge
// rules:
// - Agent Runtime is the canonical execution owner for AgentRun lifecycle and events.
// - It must consume the Knowledge Layer and ProviderRuntimeService instead of duplicating them.
// next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
// Internally wired via AgentRuntimeService (AGENT-RUNTIME-API-INTERNAL-001),
// but still not exposed through HTTP routes, Electron/Tauri commands, or the
// frontend. Module-level dead_code is allowed until an internal/product caller
// consumes the full surface (AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 gated).
#![allow(dead_code)]

pub mod catalog;
pub mod event_writer;
pub mod events;
pub mod runtime;
pub mod service;
pub mod tool_registry;
pub mod tools;
pub mod types;

#[cfg(test)]
pub mod test_support;
