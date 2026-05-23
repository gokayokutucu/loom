export interface ClipboardPayload {
  plainText: string;
  html?: string;
}

export function plainTextToClipboardHtml(value: string) {
  const escaped = escapeClipboardHtml(value);
  return `<div style="white-space: pre-wrap;">${escaped}</div>`;
}

export function codeToClipboardHtml(value: string) {
  return `<pre><code>${escapeClipboardHtml(value)}</code></pre>`;
}

export async function writeClipboardPayload(payload: ClipboardPayload) {
  const plainText = payload.plainText;
  const html = payload.html ?? plainTextToClipboardHtml(plainText);

  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Browser clipboard implementations vary; fall back to plain text.
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(plainText);
      return;
    } catch {
      // Fall through to the textarea fallback for browsers that deny async clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = plainText;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function escapeClipboardHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
