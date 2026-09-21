import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { subscribeToCollection } from '../../services/firestore';
import { auth } from '../../firebase/config';
import { COLLECTIONS, type ActivityLog } from '../../types/models';
import './NotificationsBell.css';
import './NotificationsUpdate.css';

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

/** Cada cuanto se revisa si hay una version nueva desplegada. */
const UPDATE_CHECK_MS = 2 * 60 * 1000;

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const seenKey = (): string => `berry-notis-seen-${auth.currentUser?.uid ?? 'anon'}`;

/* ---------- Deteccion de version nueva ---------- */

/** Ruta del bundle principal que esta corriendo ahora (ej. /assets/index-abc123.js). */
const runningBundle = (): string => {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.src, window.location.origin).pathname : '';
};

/**
 * Pide el index.html publicado (saltando caches y el Service Worker) y compara
 * su bundle con el que esta corriendo. Si cambio, hay un deploy nuevo.
 */
async function isNewVersionDeployed(): Promise<boolean> {
  const current = runningBundle();
  if (!current || current.startsWith('/src/')) return false; // modo desarrollo
  const response = await fetch(`/index.html?check=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return false;
  const html = await response.text();
  const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
  if (!match) return false;
  const published = new URL(match[1], window.location.origin).pathname;
  return published !== current;
}

/**
 * Aplica la version nueva: desregistra el Service Worker, borra sus caches y
 * recarga. Es el mismo protocolo que antes se hacia a mano tras cada deploy.
 */
async function applyUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}

/**
 * Campana de notificaciones:
 * - Aviso de VERSION NUEVA: cuando se despliega un cambio, la campana se
 *   activa y desde el panel se actualiza con un clic.
 * - Feed en vivo del historial de actividad de otros usuarios (ultimas 30).
 * - Contador, brinco y ping suave (Web Audio) cuando llega algo nuevo.
 */
export function NotificationsBell() {
  const [feed, setFeed] = useState<ActivityLog[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>(() => localStorage.getItem(seenKey()) ?? '');
  const [updateReady, setUpdateReady] = useState(false);
  const [updating, setUpdating] = useState(false);

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
  const badgeCount = unread.length + (updateReady ? 1 : 0);

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

  const ping = useCallback(() => {
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
  }, []);

  useEffect(() => {
    const total = unread.length;
    if (totalRef.current === null) {
      totalRef.current = total;
      return;
    }
    if (total > totalRef.current) ping();
    totalRef.current = total;
  }, [unread.length, ping]);

  /* Revision de version nueva: al arrancar, cada 2 minutos y al volver a la pestana. */
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void isNewVersionDeployed()
        .then((isNew) => {
          if (!cancelled && isNew) setUpdateReady(true);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, UPDATE_CHECK_MS);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  /* Suena una vez cuando se detecta la version nueva. */
  const announcedRef = useRef(false);
  useEffect(() => {
    if (updateReady && !announcedRef.current) {
      announcedRef.current = true;
      ping();
    }
  }, [updateReady, ping]);

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

  const runUpdate = () => {
    setUpdating(true);
    void applyUpdate();
  };

  const renderItem = (n: ActivityLog) => (
    <div className="noti__item" key={n.id}>
      <span className={`noti__dot noti__dot--${n.ACTION}`} aria-hidden="true" />
      <span className="noti__text">
        <b>{n.USER_EMAIL}</b> {ACTION_TEXT[n.ACTION] ?? n.ACTION}{' '}
        <b>{COLLECTION_LABELS[n.COLLECTION] ?? n.COLLECTION}</b>
        {n.DETAIL ? ` — ${n.DETAIL}` : ''}
        <span className="noti__time">{timeAgo(n.DATE)}</span>
      </span>
    </div>
  );

  const updateCard = updateReady && (
    <div className="noti__update">
      <div className="noti__update-text">
        <b>New version available</b>
        <span>Changes were published. Update to get the latest version.</span>
      </div>
      <button type="button" className="noti__update-btn" disabled={updating} onClick={runUpdate}>
        {updating ? 'Updating…' : 'Update now'}
      </button>
    </div>
  );

  return (
    <div className="noti">
      <button
        type="button"
        className={`noti__bell${badgeCount > 0 ? ' noti__bell--ringing' : ''}${updateReady ? ' noti__bell--update' : ''}`}
        onClick={togglePanel}
        aria-label={updateReady ? 'New version available' : badgeCount > 0 ? `${badgeCount} unread notifications` : 'Notifications'}
        title={updateReady ? 'New version available' : 'Notifications'}
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {badgeCount > 0 && <span className="noti__count">{badgeCount > 9 ? '9+' : badgeCount}</span>}
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
            {updateCard}
            <div className="noti__list">
              {others.length === 0 && !updateReady && <p className="noti__empty">No notifications yet.</p>}
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
            {updateCard}
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
