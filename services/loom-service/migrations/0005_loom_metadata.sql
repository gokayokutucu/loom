-- Add Loom metadata storage for service-side Loom creation/update.
--
-- Privacy rule: raw model thinking/internal monologue must never be persisted.
-- Do not store thinking_text, raw_thinking, chain_of_thought, or hidden_reasoning
-- keys in metadata_json.

ALTER TABLE looms ADD COLUMN metadata_json TEXT;
