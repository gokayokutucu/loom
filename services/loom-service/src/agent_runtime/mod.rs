// Loom-native experimental Agent Runtime foundation.
// Internally wired via AgentRuntimeService (AGENT-RUNTIME-API-INTERNAL-001),
// but still not exposed through HTTP routes, Electron/Tauri commands, or the
// frontend. Module-level dead_code is allowed until an internal/product caller
// consumes the full surface (AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 gated).
#![allow(dead_code)]

pub mod events;
pub mod runtime;
pub mod service;
pub mod tools;
pub mod types;

#[cfg(test)]
pub mod test_support;
