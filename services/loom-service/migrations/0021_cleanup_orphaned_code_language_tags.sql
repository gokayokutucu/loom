-- Removes stale response_tags rows with tag_kind='code' that were derived from
-- pseudo-artifact code blocks deleted by migration 0019.
--
-- Code-language tags are exclusively sourced from code block language headers
-- via extract_tags_for_response ("code_block_language" reason).  After migration
-- 0019 deleted pseudo-artifact code blocks, the corresponding code-language tags
-- in response_tags became orphaned derived data.
--
-- Safety:
--   - Only 'code' kind tags are removed.
--   - A tag is preserved when a code block with a matching language still exists
--     for the same response_id.
--   - Topic index (loom_topic_index) and same_topic graph links are unaffected:
--     'code' kind tags are NOT promoted to the topic index (the promotion filter
--     requires "topic" | "architecture" | "technology" | "domain" | "pattern" |
--     "acronym"), so no topic or same_topic graph link contamination exists.
--   - Canonical data (responses, looms, attachments, bookmarks) is untouched.
--   - The Rust-level cleanup_orphaned_code_language_tags() startup function
--     applies the same predicate as defense-in-depth.

DELETE FROM response_tags
WHERE tag_kind = 'code'
  AND NOT EXISTS (
      SELECT 1 FROM response_code_blocks rcb
      WHERE rcb.response_id = response_tags.response_id
        AND LOWER(COALESCE(rcb.language, '')) = response_tags.normalized_tag
  );
