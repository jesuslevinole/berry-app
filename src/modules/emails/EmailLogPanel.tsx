import { useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { useCollection } from '../../hooks/useCollection';
import { checkDeliveryStatus, type DeliveryStatus } from '../../services/emailService';
import { COLLECTIONS, type EmailLog } from '../../types/models';
import './EmailLogPanel.css';

/** Ultimos envios que se muestran (lecturas acotadas). */
const LOG_LIMIT = 50;

const STATUS_META: Record<DeliveryStatus, { label: string; tone: 'ok' | 'bad' | 'warn' | 'muted'; help: string }> = {
  delivered: { label: 'Delivered', tone: 'ok', help: 'Accepted by the recipient’s mail server. If it is not in the inbox, check Spam/Junk or Quarantine.' },
  opened: { label: 'Opened', tone: 'ok', help: 'The recipient opened the email.' },
  clicked: { label: 'Clicked', tone: 'ok', help: 'The recipient clicked a link.' },
  sent: { label: 'Sent', tone: 'muted', help: 'Sent; waiting for the recipient’s server to confirm.' },
  queued: { label: 'Queued', tone: 'muted', help: 'Waiting to be sent.' },
  delivery_delayed: { label: 'Delayed', tone: 'warn', help: 'The recipient’s server is delaying it. It usually arrives later.' },
  bounced: { label: 'Bounced', tone: 'bad', help: 'Rejected by the recipient’s mail server (wrong address or blocked). Check the address.' },
  complained: { label: 'Marked spam', tone: 'bad', help: 'The recipient marked it as spam.' },
  failed: { label: 'Failed', tone: 'bad', help: 'It could not be sent.' },
  unknown: { label: 'Unknown', tone: 'muted', help: 'No status available yet.' },
};

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Email Settings > Sent: historial de envios y estado de entrega de cada destinatario. */
export function EmailLogPanel() {
  const { data: logs, loading } = useCollection<EmailLog>(COLLECTIONS.EMAIL_LOG, [orderBy('DATE', 'desc'), limit(LOG_LIMIT)]);
  const [statuses, setStatuses] = useState<Record<string, DeliveryStatus>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const sorted = useMemo(() => [...logs].sort((a, b) => (b.DATE ?? '').localeCompare(a.DATE ?? '')), [logs]);

  /** Consulta a Resend el estado de los envios mas recientes. */
  const check = async () => {
    const ids = sorted.flatMap((l) => (l.RECIPIENTS ?? []).map((r) => r.RESEND_ID).filter(Boolean)).slice(0, 40);
    if (ids.length === 0) return;
    setChecking(true);
    setError('');
    try {
      const result = await checkDeliveryStatus(ids);
      setStatuses((prev) => ({ ...prev, ...result }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="email-log">
      <div className="email-log__bar">
        <p className="email-log__hint">
          Every email goes to each recipient separately. <b>Check delivery</b> asks the email provider whether each one was accepted
          by the recipient’s mail server.
        </p>
        <button type="button" className="btn btn--secondary" disabled={checking || sorted.length === 0} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check delivery'}
        </button>
      </div>
      {error && <p className="send-email__error">{error}</p>}

      <div className="email-log__card">
        <table className="email-log__table">
          <thead>
            <tr>
              <th className="email-log__th">Date</th>
              <th className="email-log__th">Document</th>
              <th className="email-log__th">Subject</th>
              <th className="email-log__th">Sent by</th>
              <th className="email-log__th">Recipients</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sorted.length === 0 && (
              <tr>
                <td className="email-log__empty" colSpan={5}>
                  No emails sent yet.
                </td>
              </tr>
            )}
            {sorted.map((log) => (
              <tr key={log.id}>
                <td className="email-log__td email-log__td--nowrap">{fmtDateTime(log.DATE)}</td>
                <td className="email-log__td email-log__td--strong email-log__td--nowrap">{log.DOC_LABEL}</td>
                <td className="email-log__td email-log__td--muted">{log.SUBJECT}</td>
                <td className="email-log__td email-log__td--muted email-log__td--nowrap">{log.SENT_BY || '—'}</td>
                <td className="email-log__td">
                  <ul className="email-log__recipients">
                    {(log.RECIPIENTS ?? []).map((r) => {
                      const status: DeliveryStatus | null = r.ERROR ? 'failed' : r.RESEND_ID ? (statuses[r.RESEND_ID] ?? null) : null;
                      const meta = status ? STATUS_META[status] ?? STATUS_META.unknown : null;
                      return (
                        <li key={r.EMAIL} className="email-log__recipient">
                          <span className="email-log__email">{r.EMAIL}</span>
                          {meta ? (
                            <span className={`email-log__pill email-log__pill--${meta.tone}`} title={r.ERROR || meta.help}>
                              {meta.label}
                            </span>
                          ) : (
                            <span className="email-log__pill email-log__pill--muted" title="Press Check delivery to see the status">
                              Sent
                            </span>
                          )}
                          {r.ERROR && <span className="email-log__error">{r.ERROR}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
