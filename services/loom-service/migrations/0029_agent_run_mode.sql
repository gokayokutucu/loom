-- AgentRun mode foundation.
-- (QUICK-ASK-AGENTRUN-MODE-001)
--
-- Adds a safe mode discriminator for future lightweight Quick Ask AgentRun
-- rows. This stores metadata only. It must not persist prompts, raw context
-- bodies, provider payloads, raw thinking, tool output, credentials, or secrets.

ALTER TABLE agent_runs
  ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'full_conversation'
  CHECK (run_mode IN ('full_conversation', 'lightweight_quick_ask'));

CREATE INDEX IF NOT EXISTS idx_agent_runs_mode_started
  ON agent_runs(run_mode, started_at);
