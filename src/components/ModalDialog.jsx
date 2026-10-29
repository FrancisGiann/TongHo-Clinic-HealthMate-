import './ContextDialogs.css';
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export default function ModalDialog({ open, title, eyebrow, onClose, busy = false, children, className = "", descriptionId, initialFocusSelector, historyKey }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const historyMarkerRef = useRef(null);
  const historyGenerationRef = useRef(0);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open || !historyKey) return;
    const generation = ++historyGenerationRef.current;
    const marker = historyMarkerRef.current ||= `healthmate-dialog-${Date.now()}-${Math.random()}`;
    const original = window.history.state;
    if (original?.healthmateDialog !== marker) window.history.pushState({ ...original, healthmateDialog: marker }, '', window.location.href);
    const onBack = () => {
      if (busyRef.current) {
        window.history.pushState({ ...original, healthmateDialog: marker }, '', window.location.href);
      } else closeRef.current?.();
    };
    window.addEventListener('popstate', onBack);
    return () => {
      window.removeEventListener('popstate', onBack);
      queueMicrotask(() => {
        if (historyGenerationRef.current === generation && window.history.state?.healthmateDialog === marker) window.history.back();
      });
    };
  }, [open, historyKey]);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      const initialFocus = (initialFocusSelector && dialog.querySelector(initialFocusSelector))
        || dialog.querySelector("[autofocus]")
        || dialog.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
      initialFocus?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusSelector]);

  const closeIfAllowed = () => {
    if (!busy) onClose?.();
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const handleBackdropClick = (event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      closeIfAllowed();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`modal-card quick-entry-dialog ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal-heading">
        <div>
          {eyebrow && <p className="section-kicker">{eyebrow}</p>}
          <h3 id={titleId}>{title}</h3>
        </div>
        <button type="button" className="icon-btn" onClick={closeIfAllowed} aria-label={`Close ${title} dialog`} disabled={busy}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
