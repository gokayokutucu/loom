import type { ContextMenuRequest } from "./contextMenu";

export interface HostShellAdapter {
  getPlatform(): string;
  copyText(value: string): Promise<void>;
  openContextMenu(request: ContextMenuRequest): boolean;
}

export const browserHostShell: HostShellAdapter = {
  getPlatform() {
    return navigator.platform || "web";
  },
  async copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    }
  },
  openContextMenu(_request) {
    return false;
  },
};
