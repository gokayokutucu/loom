import type { ContextMenuRequest } from "./contextMenu";
import { type ClipboardPayload, writeClipboardPayload } from "./clipboard";

export interface HostShellAdapter {
  getPlatform(): string;
  copyText(value: string): Promise<void>;
  copyRichText(payload: ClipboardPayload): Promise<void>;
  openContextMenu(request: ContextMenuRequest): boolean;
}

export const browserHostShell: HostShellAdapter = {
  getPlatform() {
    return navigator.platform || "web";
  },
  async copyText(value) {
    await writeClipboardPayload({ plainText: value });
  },
  async copyRichText(payload) {
    await writeClipboardPayload(payload);
  },
  openContextMenu(_request) {
    return false;
  },
};
