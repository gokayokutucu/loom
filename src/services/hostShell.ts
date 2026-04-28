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
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Fall through to the textarea fallback for browsers that deny async clipboard writes.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  },
  openContextMenu(_request) {
    return false;
  },
};
