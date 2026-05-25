/**
 * Address bar context menu — types and utilities shared between the Electron
 * IPC bridge and the renderer-side handler.
 */

export type AddressBarContextMenuAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "pasteAndGo"
  | "pasteAndGoToLoom"
  | "copyCleanLink"
  | "none";

export interface AddressBarContextMenuParams {
  /** Current input has any text at all */
  hasText: boolean;
  /** Some text is selected */
  hasSelection: boolean;
  /** All text is already selected (→ Select All should be disabled) */
  allSelected: boolean;
  /** Current destination or selected text is a loom:// address */
  hasLoomAddress: boolean;
}

export interface AddressBarContextMenuResult {
  action: AddressBarContextMenuAction;
  /** Clipboard text read by the main process (available for paste actions) */
  clipboardText: string;
}

// ---------------------------------------------------------------------------
// Clean link extraction
// ---------------------------------------------------------------------------

/**
 * Extract and clean a loom:// address from an arbitrary string.
 *
 * Rules:
 * - Returns null if the trimmed string does not start with "loom://"
 * - Strips trailing sentence punctuation that is clearly outside the URL:
 *   ) ] . , ; : ! ?
 *
 * Query params/fragments that are valid parts of the URL are preserved.
 * The function does NOT validate the URL structure beyond the protocol prefix.
 */
export function extractCleanLoomAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("loom://")) return null;
  // Strip one or more trailing punctuation characters that are unlikely to be
  // part of the URL (closing parens/brackets, sentence-ending marks).
  return trimmed.replace(/[)\].,;:!?]+$/, "");
}
