/**
 * Composer context menu — types shared between the Electron IPC bridge and
 * the renderer-side handler in the prompt editor (contentEditable div).
 */

export type ComposerContextMenuAction =
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "none";

export interface ComposerContextMenuParams {
  /** Some text is currently selected in the editor */
  hasSelection: boolean;
  /** The editor has any content at all */
  hasContent: boolean;
}

export interface ComposerContextMenuResult {
  action: ComposerContextMenuAction;
  /** Clipboard text read by the main process (available for the paste action) */
  clipboardText: string;
}
