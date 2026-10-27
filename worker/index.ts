/**
 * Worker de Berry: sirve la app (dist/) y enruta la API.
 *  - /api/send-email y /api/email-status: correos (email.ts).
 *  - /api/billing/*: cobro de suscripciones con Square (billing.ts).
 * Las rutas /api/* verifican el ID token de Firebase del usuario (firebaseAuth.ts), salvo
 * /api/billing/config (datos publicos) y /api/billing/webhook (firma de Square).
 */
import type { Env } from './env';
import { handleBillingConfig, handleCancel, handleSquareWebhook, handleSubscribe, handleSyncPlans } from './billing';
import { handleEmailStatus, handleSendEmail } from './email';
import { json } from './http';

/* Rutas POST del cobro (cada una valida quien llama). */
const BILLING_ROUTES: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  '/api/billing/sync-plans': handleSyncPlans,
  '/api/billing/subscribe': handleSubscribe,
  '/api/billing/cancel': handleCancel,
  '/api/billing/webhook': handleSquareWebhook,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/email-status') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      try {
        return await handleEmailStatus(request, env);
      } catch {
        return json({ error: 'Could not check the delivery status.' }, 500);
      }
    }
    if (url.pathname === '/api/send-email') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      try {
        return await handleSendEmail(request, env);
      } catch {
        return json({ error: 'Unexpected error sending the email.' }, 500);
      }
    }
    if (url.pathname === '/api/billing/config') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      return handleBillingConfig(env);
    }
    const billingRoute = BILLING_ROUTES[url.pathname];
    if (billingRoute) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      try {
        return await billingRoute(request, env);
      } catch (error) {
        console.error('Billing error:', url.pathname, (error as Error).message);
        return json({ error: 'Unexpected error with the payment. Try again.' }, 500);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    /* Todo lo demas es la app (con fallback de SPA configurado en wrangler.jsonc). */
    return env.ASSETS.fetch(request);
  },
};
