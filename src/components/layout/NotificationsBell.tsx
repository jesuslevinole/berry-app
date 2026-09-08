import { useEffect, useMemo, useRef, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { subscribeToCollection } from '../../services/firestore';
import { auth } from '../../firebase/config';
import { COLLECTIONS, type ActivityLog } from '../../types/models';
import './NotificationsBell.css';

const COLLECTION_LABELS: Record<string, string> = {
  [COLLECTIONS.PURCHASE_ORDER]: 'Purchase Orders',
  [COLLECTIONS.PURCHASE_DETAILS]: 'Purchase Order lines',
  [COLLECTIONS.SALES_ORDER]: 'Sales Desk',
  [COLLECTIONS.SALES_ORDER_DETAIL]: 'Sales Desk lines',
  [COLLECTIONS.EXPENSES]: 'Expenses',
  [COLLECTIONS.CHECKS]: 'Checkbook',
  [COLLECTIONS.SYSTEM_USERS]: 'System Users',
};

const ACTION_TEXT: Record<ActivityLog['ACTION'], string> = {
  create: 'created a record in',
  update: 'updated a record in',
  delete: 'deleted a record from',
  restore: 'restored a record to',
};

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const seenKey = (): string => `berry-notis-seen-${auth.currentUser?.uid ?? 'anon'}`;

/**
 * Campana de notificaciones (patron del proyecto Roelca):
 * - Feed en vivo del historial de actividad (ultimas 30).
 * - Punto rojo con contador y brinco mientras haya notificaciones sin ver.
 * - Ping suave (Web Audio, sin archivos) cuando LLEGA algo nuevo de otro usuario;
 *   nunca al iniciar sesion ni repetido.
 * - Panel con las recientes y modal "View all" con el historico completo.
 */
export function NotificationsBell() {
  const [feed, setFeed] = useState<ActivityLog[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>(() => localStorage.getItem(seenKey()) ?? '');

  useEffect(() => {
    const unsub = subscribeToCollection<ActivityLog>(
      COLLECTIONS.ACTIVITY_LOG,
      setFeed,
      () => setFeed([]),
      [orderBy('DATE', 'desc'), limit(30)],
    );
    return () => unsub();
  }, []);

  /* Notificaciones = actividad de OTROS usuarios; lo propio no suena ni cuenta. */
  const myEmail = auth.currentUser?.email ?? '';
  const others = useMemo(() => feed.filter((n) => n.USER_EMAIL !== myEmail), [feed, myEmail]);
  const unread = useMemo(() => others.filter((n) => !seenAt || n.DATE > seenAt), [others, seenAt]);

  /* Ping (Web Audio) al llegar algo nuevo; el navegador exige interaccion previa. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const totalRef = useRef<number | null>(null);
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume();
      } catch {
        /* sin audio */
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const ping = () => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.09);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    } catch {
      /* autoplay bloqueado: silencio */
    }
  };

  useEffect(() => {
    const total = others.length ? others.filter((n) => !seenAt || n.DATE > seenAt).length : 0;
    if (totalRef.current === null) {
      totalRef.current = total;
      return;
    }
    if (total > totalRef.current) ping();
    totalRef.current = total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others.length]);

  const markSeen = () => {
    const now = new Date().toISOString();
    setSeenAt(now);
    localStorage.setItem(seenKey(), now);
  };

  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (next) markSeen();
  };

  const renderItem = (n: ActivityLog) => (
    <div className="noti__item" key={n.id}>
      <span className={`noti__dot noti__dot--${n.ACTION}`} aria-hidden="true" />
      <span className="noti__text">
        <b>{n.USER_EMAIL}</b> {ACTION_TEXT[n.ACTION] ?? n.ACTION}{' '}
        <b>{COLLECTION_LABELS[n.COLLECTION] ?? n.COLLECTION}</b>
        {n.DETAIL ? ` \u2014 ${n.DETAIL}` : ''}
        <span className="noti__time">{timeAgo(n.DATE)}</span>
      </span>
    </div>
  );

  return (
    <div className="noti">
      <button
        type="button"
        className={`noti__bell${unread.length > 0 ? ' noti__bell--ringing' : ''}`}
        onClick={togglePanel}
        aria-label={unread.length > 0 ? `${unread.length} unread notifications` : 'Notifications'}
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread.length > 0 && <span className="noti__count">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>

      {panelOpen && (
        <>
          <div className="noti__backdrop" onClick={() => setPanelOpen(false)} />
          <div className="noti__panel">
            <div className="noti__panel-head">
              <span className="noti__panel-title">Notifications</span>
              <button type="button" className="noti__viewall" onClick={() => { setAllOpen(true); setPanelOpen(false); }}>
                View all
              </button>
            </div>
            <div className="noti__list">
              {others.length === 0 && <p className="noti__empty">No notifications yet.</p>}
              {others.slice(0, 10).map(renderItem)}
            </div>
          </div>
        </>
      )}

      {allOpen && (
        <div className="noti__overlay" onClick={() => setAllOpen(false)}>
          <div className="noti__modal" onClick={(e) => e.stopPropagation()}>
            <div className="noti__panel-head">
              <span className="noti__panel-title">All notifications</span>
              <button type="button" className="noti__viewall" onClick={() => setAllOpen(false)}>Close</button>
            </div>
            <div className="noti__list noti__list--tall">
              {feed.length === 0 && <p className="noti__empty">No notifications yet.</p>}
              {feed.map(renderItem)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
