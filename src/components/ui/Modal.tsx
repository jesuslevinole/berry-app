import { useEffect, type ReactNode } from 'react';
import './Modal.css';

/** Mensaje unico de confirmacion al cerrar cualquier formulario. */
export const CONFIRM_CLOSE_MESSAGE = 'Are you sure you want to close the form?';

/** Cierra un formulario solo si el usuario confirma. Usar en los botones Cancel. */
export function confirmClose(onClose: () => void): void {
  if (window.confirm(CONFIRM_CLOSE_MESSAGE)) onClose();
}

interface ModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Pide confirmacion antes de cerrar por overlay, X o Escape (por defecto si). */
  confirmOnClose?: boolean;
}

export function Modal({ title, open, onClose, children, footer, wide = false, confirmOnClose = true }: ModalProps) {
  const requestClose = () => {
    if (!confirmOnClose || window.confirm(CONFIRM_CLOSE_MESSAGE)) onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!confirmOnClose || window.confirm(CONFIRM_CLOSE_MESSAGE)) onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, confirmOnClose]);

  if (!open) return null;

  return (
    <div
      className="modal__overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button type="button" className="btn btn--icon" onClick={requestClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}
