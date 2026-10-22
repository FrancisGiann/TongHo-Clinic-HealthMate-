import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export default function ModalDialog({ open, title, eyebrow, onClose, busy = false, children, className = "", descriptionId, initialFocusSelector }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
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
