import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LoomLink } from "../types";
import { AddressHintPopover } from "./AddressHintPopover";

const DEFAULT_HINT_DELAY_MS = 2000;
const DEFAULT_HINT_AUTO_CLOSE_MS = 0;

interface AddressMetadataBadgeProps {
  link: LoomLink;
  children: ReactNode;
  as?: "span" | "button";
  className?: string;
  title?: string;
  testId?: string;
  delayMs?: number;
  autoCloseMs?: number;
  showHint?: boolean;
  ariaLabel?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onCopy?: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, link: LoomLink) => void;
}

export function AddressMetadataBadge({
  link,
  children,
  as = "span",
  className,
  title,
  testId,
  delayMs = DEFAULT_HINT_DELAY_MS,
  autoCloseMs = DEFAULT_HINT_AUTO_CLOSE_MS,
  showHint = true,
  ariaLabel,
  onClick,
  onCopy,
  onContextMenu,
}: AddressMetadataBadgeProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const autoCloseTimerRef = useRef<number | null>(null);
  const closeAnimationTimerRef = useRef<number | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [popoverClosing, setPopoverClosing] = useState(false);

  function clearTimer() {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function clearCloseTimer() {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function clearAutoCloseTimer() {
    if (autoCloseTimerRef.current === null) return;
    window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = null;
  }

  function clearCloseAnimationTimer() {
    if (closeAnimationTimerRef.current === null) return;
    window.clearTimeout(closeAnimationTimerRef.current);
    closeAnimationTimerRef.current = null;
  }

  function removePopover() {
    clearCloseAnimationTimer();
    setPopoverStyle(null);
    setPopoverClosing(false);
  }

  function cancelClosePopover() {
    clearCloseTimer();
    clearCloseAnimationTimer();
    setPopoverClosing(false);
  }

  function closePopover(immediate = false) {
    clearTimer();
    clearCloseTimer();
    clearAutoCloseTimer();
    if (immediate) {
      removePopover();
      return;
    }
    setPopoverClosing(true);
    clearCloseAnimationTimer();
    closeAnimationTimerRef.current = window.setTimeout(removePopover, 260);
  }

  function scheduleClosePopover() {
    clearTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(closePopover, 180);
  }

  function openPopover() {
    if (!showHint) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    cancelClosePopover();
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPopoverStyle({
      left,
      top: Math.min(window.innerHeight - 8, rect.bottom + 10),
    });
    clearAutoCloseTimer();
    if (autoCloseMs) {
      autoCloseTimerRef.current = window.setTimeout(closePopover, autoCloseMs);
    }
  }

  function schedulePopover() {
    if (!showHint) return;
    cancelClosePopover();
    clearTimer();
    timerRef.current = window.setTimeout(openPopover, delayMs);
  }

  function restartStillHoverTimer() {
    if (!showHint) return;
    closePopover(true);
    schedulePopover();
  }

  useEffect(() => {
    if (!popoverStyle) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePopover();
    }
    function handleViewportChange() {
      closePopover(true);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [popoverStyle]);

  useEffect(
    () => () => {
      clearTimer();
      clearCloseTimer();
      clearAutoCloseTimer();
      clearCloseAnimationTimer();
    },
    []
  );

  const triggerProps = {
    className,
    title,
    "aria-label": ariaLabel,
    "data-testid": testId,
    tabIndex: showHint && as === "span" ? 0 : undefined,
    onMouseEnter: showHint ? schedulePopover : undefined,
    onMouseMove: showHint ? restartStillHoverTimer : undefined,
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      if (!showHint) return;
      if (
        event.relatedTarget instanceof HTMLElement &&
        event.relatedTarget.closest(".address-hint-popover")
      ) {
        return;
      }
      scheduleClosePopover();
    },
    onFocus: showHint ? openPopover : undefined,
    onBlur: showHint ? scheduleClosePopover : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => {
      closePopover(true);
      onClick?.(event);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      closePopover(true);
      onContextMenu?.(event, link);
    },
  };

  return (
    <>
      {as === "button" ? (
        <button
          {...triggerProps}
          ref={(node) => {
            triggerRef.current = node;
          }}
          type="button"
        >
          {children}
        </button>
      ) : (
        <span
          {...triggerProps}
          ref={(node) => {
            triggerRef.current = node;
          }}
        >
          {children}
        </span>
      )}
      {popoverStyle &&
        createPortal(
          <AddressHintPopover
            link={link}
            style={popoverStyle}
            closing={popoverClosing}
            onEnter={cancelClosePopover}
            onCopy={onCopy}
            onClose={scheduleClosePopover}
          />,
          document.body
        )}
    </>
  );
}
