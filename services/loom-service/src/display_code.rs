const DISPLAY_ALPHABET: &[u8] = b"2346789ABCDEFGHJKLMNPQRTVWXYZ";
const DISPLAY_TOKEN_LEN: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisplayCodeKind {
    Loom,
    Weft,
    Response,
}

impl DisplayCodeKind {
    fn prefix(self) -> &'static str {
        match self {
            Self::Loom => "L",
            Self::Weft => "W",
            Self::Response => "R",
        }
    }

    fn seed_prefix(self) -> &'static str {
        match self {
            Self::Loom => "loom",
            Self::Weft => "weft",
            Self::Response => "response",
        }
    }
}

pub fn display_code(kind: DisplayCodeKind, canonical_id: &str) -> String {
    let seed = format!("{}:{canonical_id}", kind.seed_prefix());
    format!("{}-{}", kind.prefix(), stable_display_token(&seed))
}

fn stable_display_token(seed: &str) -> String {
    let mut value = fnv1a64(seed.as_bytes());
    let base = DISPLAY_ALPHABET.len() as u64;
    let mut output = vec![DISPLAY_ALPHABET[0]; DISPLAY_TOKEN_LEN];
    for index in (0..DISPLAY_TOKEN_LEN).rev() {
        output[index] = DISPLAY_ALPHABET[(value % base) as usize];
        value /= base;
    }
    String::from_utf8(output).unwrap_or_else(|_| "222222".to_string())
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::{display_code, DisplayCodeKind};

    #[test]
    fn display_code_uses_entity_prefixes() {
        assert!(display_code(DisplayCodeKind::Loom, "loom-1").starts_with("L-"));
        assert!(display_code(DisplayCodeKind::Weft, "weft-1").starts_with("W-"));
        assert!(display_code(DisplayCodeKind::Response, "response-1").starts_with("R-"));
    }

    #[test]
    fn display_code_is_stable_for_same_canonical_id() {
        assert_eq!(
            display_code(
                DisplayCodeKind::Weft,
                "weft-r-mcp-invocation-flow-1778832856779443000"
            ),
            display_code(
                DisplayCodeKind::Weft,
                "weft-r-mcp-invocation-flow-1778832856779443000"
            )
        );
    }

    #[test]
    fn display_code_hides_long_timestamp_based_ids() {
        let code = display_code(
            DisplayCodeKind::Weft,
            "weft-r-mcp-invocation-flow-1778832856779443000",
        );

        assert_eq!(code.len(), 8);
        assert!(!code.contains("1778832856779443000"));
        assert!(!code.contains("INVOCATION"));
    }
}
