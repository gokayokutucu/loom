// Loom-native experimental Agent Runtime foundation.
// Internal-only: not wired into production generation paths or HTTP routes yet.
// Module-level dead_code is allowed temporarily until AGENT-RUNTIME-API-INTERNAL-001 wires the module internally.
#![allow(dead_code)]

pub mod events;
pub mod runtime;
pub mod types;
