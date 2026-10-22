import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import ModalDialog from '../components/ModalDialog';

export default function useConfirmation() {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);
  const descriptionId = useId();

  const finish = useCallback((accepted) => {
    const resolve = pending.current;
    if (!resolve) return;
    pending.current = null;
    setRequest(null);
    resolve(accepted);
  }, []);

  const confirmAction = useCallback((options) => {
    // A repeated click cannot queue another confirmation or run its action twice.
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest(options);
    });
  }, []);

  useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);

  const confirmationDialog = (
    <ModalDialog
      open={Boolean(request)}
      title={request?.title || 'Confirm action'}
      eyebrow="Please confirm"
      onClose={() => finish(false)}
      className="confirmation-dialog"
      descriptionId={descriptionId}
      initialFocusSelector="[data-confirm-cancel]"
    >
      <div className="confirmation-dialog-message">
        <TriangleAlert size={22} aria-hidden="true" />
        <p id={descriptionId}>{request?.message}</p>
      </div>
      <div className="form-actions">
        <button type="button" className="secondary-btn" data-confirm-cancel onClick={() => finish(false)}>
          {request?.cancelLabel || 'Cancel'}
        </button>
        <button type="button" className="primary-btn confirmation-action" onClick={() => finish(true)}>
          {request?.confirmLabel || 'Confirm'}
        </button>
      </div>
    </ModalDialog>
  );

  return { confirmAction, confirmationDialog };
}
