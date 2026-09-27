import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export default function ModalDialog({ open, title, eyebrow, onClose, busy = false, children, className = "" }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      const initialFocus = dialog.querySelector("[autofocus]")
        || dialog.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
      initialFocus?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const closeIfAllowed = () => {
    if (!busy) onClose?.();
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
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClick={handleBackdropClick}
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
