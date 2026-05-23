import { createPortal } from "react-dom";
import { BookmarkCheck, Copy, GitFork, Sparkles, type LucideIcon } from "lucide-react";

export type ToastNotificationColor =
  | "neutral"
  | "blue"
  | "green"
  | "orange"
  | "red"
  | "sunset";
export type ToastNotificationIcon = "bookmark" | "copy" | "sparkles" | "weft";

interface ToastNotificationProps {
  open: boolean;
  message: string;
  title?: string;
  icon?: ToastNotificationIcon;
  color?: ToastNotificationColor;
  testId?: string;
}

const toastIcons: Record<ToastNotificationIcon, LucideIcon> = {
  bookmark: BookmarkCheck,
  copy: Copy,
  sparkles: Sparkles,
  weft: GitFork,
};

export function ToastNotification({
  open,
  message,
  title,
  icon,
  color = "neutral",
  testId = "toast-notification",
}: ToastNotificationProps) {
  if (!open) return null;
  const Icon = icon ? toastIcons[icon] : undefined;

  return createPortal(
    <div
      className="toast-notification"
      data-color={color}
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-label={title ? `${title}. ${message}` : message}
    >
      {Icon && (
        <span className="toast-notification-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
      )}
      <span className="toast-notification-copy">
        {title && <strong>{title}</strong>}
        <span>{message}</span>
      </span>
    </div>,
    document.body
  );
}
