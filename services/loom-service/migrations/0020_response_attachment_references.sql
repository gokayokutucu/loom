-- Associates attachments that were sent with a specific user response.
-- This allows the UI to display attachment chips above user message bubbles
-- and supports re-rendering them on loom reload.

CREATE TABLE IF NOT EXISTS response_attachment_references (
    response_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (response_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_response_attachment_references_response
    ON response_attachment_references(response_id);
