import { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";

export function RetryConfirmationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="delete-dialog retry-confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="retry-confirmation-title"
      >
        <div className="danger-icon">
          <RotateCcw size={20} />
        </div>
        <h2 id="retry-confirmation-title">Retry from this message?</h2>
        <p>
          Retrying from this message will remove later messages from this Loom.
          Existing Wefts will be preserved.
        </p>
        <div className="dialog-actions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="delete-button" type="button" onClick={onConfirm}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
