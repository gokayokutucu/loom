import { createPortal } from "react-dom";

export type ToastNotificationColor = "neutral" | "blue" | "green" | "orange" | "red";

interface ToastNotificationProps {
  open: boolean;
  message: string;
  color?: ToastNotificationColor;
  testId?: string;
}

export function ToastNotification({
  open,
  message,
  color = "neutral",
  testId = "toast-notification",
}: ToastNotificationProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="toast-notification"
      data-color={color}
      data-testid={testId}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>,
    document.body
  );
}
