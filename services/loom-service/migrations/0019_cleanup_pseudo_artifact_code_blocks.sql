-- Removes historical pseudo-artifact code blocks that should not have been materialized.
-- Targets three SQL-detectable patterns: nested markdown fences, fake artifact metadata
-- with multiple known markers, and conversational transcript content. The Rust-level
-- cleanup at startup applies is_reusable_code_artifact() for any remaining cases.

-- Step 1: Detach response_parts references before deletion.
UPDATE response_parts
SET code_block_id = NULL
WHERE code_block_id IN (
    SELECT code_block_id FROM response_code_blocks
    WHERE
        -- Nested markdown fence markers embedded in code (illustrative wrapper blocks)
        (code LIKE '%```%' OR code LIKE '%~~~%')
        -- Fake artifact metadata: requires at least two known marker phrases co-occurring
        OR (
            (
                LOWER(code) LIKE '%hash:%'
                OR LOWER(code) LIKE '%provenance:%'
                OR LOWER(code) LIKE '%artifact reference id%'
                OR LOWER(code) LIKE '%artifact referans id%'
                OR LOWER(code) LIKE '%code-0%'
            )
            AND (
                LOWER(code) LIKE '%hash generation%'
                OR LOWER(code) LIKE '%type classification%'
                OR LOWER(code) LIKE '%storage reference%'
                OR LOWER(code) LIKE '%[timestamp, user, tool]%'
                OR LOWER(code) LIKE '%metadata population%'
                OR LOWER(code) LIKE '%artifact creation%'
                OR LOWER(code) LIKE '%provenance chain%'
            )
        )
        -- Conversational transcript content
        OR (LOWER(code) LIKE '%user:%' AND LOWER(code) LIKE '%assistant:%')
);

-- Step 2: Remove orphaned graph links whose source was a pseudo-artifact code block.
DELETE FROM context_graph_links
WHERE source_id IN (
    SELECT code_block_id FROM response_code_blocks
    WHERE
        (code LIKE '%```%' OR code LIKE '%~~~%')
        OR (
            (
                LOWER(code) LIKE '%hash:%'
                OR LOWER(code) LIKE '%provenance:%'
                OR LOWER(code) LIKE '%artifact reference id%'
                OR LOWER(code) LIKE '%artifact referans id%'
                OR LOWER(code) LIKE '%code-0%'
            )
            AND (
                LOWER(code) LIKE '%hash generation%'
                OR LOWER(code) LIKE '%type classification%'
                OR LOWER(code) LIKE '%storage reference%'
                OR LOWER(code) LIKE '%[timestamp, user, tool]%'
                OR LOWER(code) LIKE '%metadata population%'
                OR LOWER(code) LIKE '%artifact creation%'
                OR LOWER(code) LIKE '%provenance chain%'
            )
        )
        OR (LOWER(code) LIKE '%user:%' AND LOWER(code) LIKE '%assistant:%')
);

-- Step 3: Delete the pseudo-artifact rows.
DELETE FROM response_code_blocks
WHERE
    (code LIKE '%```%' OR code LIKE '%~~~%')
    OR (
        (
            LOWER(code) LIKE '%hash:%'
            OR LOWER(code) LIKE '%provenance:%'
            OR LOWER(code) LIKE '%artifact reference id%'
            OR LOWER(code) LIKE '%artifact referans id%'
            OR LOWER(code) LIKE '%code-0%'
        )
        AND (
            LOWER(code) LIKE '%hash generation%'
            OR LOWER(code) LIKE '%type classification%'
            OR LOWER(code) LIKE '%storage reference%'
            OR LOWER(code) LIKE '%[timestamp, user, tool]%'
            OR LOWER(code) LIKE '%metadata population%'
            OR LOWER(code) LIKE '%artifact creation%'
            OR LOWER(code) LIKE '%provenance chain%'
        )
    )
    OR (LOWER(code) LIKE '%user:%' AND LOWER(code) LIKE '%assistant:%');
