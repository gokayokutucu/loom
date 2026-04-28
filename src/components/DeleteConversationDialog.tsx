import { Trash2 } from "lucide-react";
import type { Conversation } from "../types";

export function DeleteConversationDialog({
  conversation,
  onCancel,
  onConfirm,
}: {
  conversation: Conversation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
      >
        <div className="danger-icon">
          <Trash2 size={20} />
        </div>
        <h2 id="delete-title">Delete this conversation permanently?</h2>
        <p>
          Deleting <strong>{conversation.title}</strong> removes the conversation and
          can break Loom references, bookmarks, and bookmarked links that point to it.
          Archive keeps the destination recoverable; delete does not.
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="delete-button" onClick={onConfirm}>
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
