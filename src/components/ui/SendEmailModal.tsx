import { useState } from 'react';
import { Modal } from './Modal';
import { FormField, FormGrid } from './FormField';
import { useEmailRecipients } from '../../hooks/useEmailRecipients';
import { sendEmail, textToHtml, type EmailAttachment } from '../../services/emailService';
import { emailDocLabel } from '../../config/emailDocs';
import type { EmailDocType } from '../../types/models';
import './SendEmailModal.css';

interface Props {
  /** Tipo de documento: decide que destinatarios vienen marcados (Email Settings). */
  docType: EmailDocType;
  title: string;
  defaultSubject: string;
  defaultMessage: string;
  /** Nombre del archivo que se adjunta (se muestra antes de enviar). */
  attachmentName: string;
  /** Genera el adjunto al momento de enviar (PDF en base64). */
  buildAttachment: () => Promise<EmailAttachment>;
  onClose: () => void;
  onSent?: () => void;
}

/**
 * Envia un documento por correo. Solo se puede elegir entre los correos
 * autorizados en Email Settings; vienen marcados los configurados para este documento.
 */
export function SendEmailModal({ docType, title, defaultSubject, defaultMessage, attachmentName, buildAttachment, onClose, onSent }: Props) {
  const { active, defaultsFor, loading } = useEmailRecipients();
  /* null = todavia no se ha tocado: se usan los marcados por defecto. */
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? defaultsFor(docType);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [status, setStatus] = useState<'idle' | 'building' | 'sending'>('idle');
  const [error, setError] = useState('');
  const busy = status !== 'idle';

  const toggle = (email: string) =>
    setPicked(selected.includes(email) ? selected.filter((e) => e !== email) : [...selected, email]);

  const send = async () => {
    setError('');
    if (selected.length === 0) {
      setError('Select at least one recipient.');
      return;
    }
    if (!subject.trim()) {
      setError('The subject is required.');
      return;
    }
    try {
      setStatus('building');
      const attachment = await buildAttachment();
      setStatus('sending');
      await sendEmail({ to: selected, subject: subject.trim(), html: textToHtml(message), attachments: [attachment] });
      onSent?.();
      alert(`${emailDocLabel(docType)} sent to ${selected.join(', ')}.`);
      onClose();
    } catch (e) {
      setError((e as Error).message || 'The email could not be sent.');
    } finally {
      setStatus('idle');
    }
  };

  return (
    <Modal
      title={title}
      open
      onClose={busy ? () => undefined : onClose}
      confirmOnClose={false}
      footer={
        <>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || selected.length === 0} onClick={() => void send()}>
            {status === 'building' ? 'Preparing PDF…' : status === 'sending' ? 'Sending…' : `Send to ${selected.length || ''}`.trim()}
          </button>
        </>
      }
    >
      <div className="send-email__recipients">
        <span className="send-email__label">To</span>
        {loading ? (
          <p className="send-email__muted">Loading recipients…</p>
        ) : active.length === 0 ? (
          <p className="send-email__muted">
            No authorized recipients yet. Add them in <b>Email Settings</b>.
          </p>
        ) : (
          <div className="send-email__list">
            {active.map((r) => (
              <label key={r.id} className={`send-email__option${selected.includes(r.EMAIL) ? ' send-email__option--on' : ''}`}>
                <input type="checkbox" checked={selected.includes(r.EMAIL)} onChange={() => toggle(r.EMAIL)} disabled={busy} />
                <span className="send-email__who">
                  <b>{r.NAME || r.EMAIL}</b>
                  {r.NAME && <span>{r.EMAIL}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <FormGrid>
        <FormField label="Subject" required span2>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label="Message" span2>
          <textarea className="input send-email__message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
        </FormField>
      </FormGrid>

      <div className="send-email__attachment">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l8.5-8.5a3.7 3.7 0 015.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.6-2.6l7.8-7.8" />
        </svg>
        <span>{attachmentName}</span>
      </div>

      {error && <p className="send-email__error">{error}</p>}
    </Modal>
  );
}
