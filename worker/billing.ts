/**
 * Cobro de suscripciones con Square.
 *  - GET  /api/billing/config      datos publicos para el formulario de tarjeta (Web Payments SDK).
 *  - POST /api/billing/sync-plans  (plataforma) crea en Square los planes de Plans & pricing.
 *  - POST /api/billing/subscribe   (dueno de la empresa) guarda la tarjeta y crea la suscripcion.
 *  - POST /api/billing/cancel      (dueno de la empresa) cancela al final del periodo pagado.
 *  - POST /api/billing/webhook     avisos de Square (firma verificada): pagos, cambios, cobros fallidos.
 *
 * Quien paga y hasta cuando lo escribe SOLO este Worker con la cuenta de servicio: las reglas
 * de Firestore no dejan que una empresa modifique su propia ficha (companies/{id}).
 */
import type { Env } from './env';
import { verifyFirebaseToken, type FirebaseClaims } from './firebaseAuth';
import { FirestoreAdmin, type FirestoreData } from './firestoreAdmin';
import { json } from './http';
import { isValidSquareSignature, SquareClient, SquareError, toCents, type SquareCard, type SquareSubscription } from './square';

/* Mapeo plan del app -> objetos de Square. Solo lo lee y escribe el Worker. */
const BILLING_PLANS = 'platform_billing_plans';
const COMPANIES = 'companies';
const PLATFORM_PLANS = 'platform_plans';
const PLATFORM_PAYMENTS = 'platform_payments';

/* Zona horaria de los cobros (las empresas estan en Texas). */
const BILLING_TIMEZONE = 'America/Chicago';
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type Cycle = 'monthly' | 'annual';

interface BillingPlanMap {
  squarePlanId?: string;
  monthlyVariationId?: string;
  monthlyAmount?: number;
  annualVariationId?: string;
  annualAmount?: number;
}

/* ---------------- utilidades ---------------- */

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const addDaysISO = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

const isISODate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const bearer = (request: Request): string => {
  const auth = request.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
};

const adminOf = (env: Env): FirestoreAdmin => {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  return new FirestoreAdmin(env.FIREBASE_SERVICE_ACCOUNT);
};

const squareOf = (env: Env): SquareClient => new SquareClient(env.SQUARE_ACCESS_TOKEN, env.SQUARE_ENV);

const readBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

/** Usuario de Firebase que llama (o la respuesta de error lista para devolver). */
async function signedInUser(request: Request, env: Env): Promise<{ claims: FirebaseClaims; token: string } | Response> {
  const token = bearer(request);
  if (!token) return json({ error: 'Sign in first.' }, 401);
  try {
    return { claims: await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID), token };
  } catch {
    return json({ error: 'Your session is not valid. Sign in again.' }, 401);
  }
}

/**
 * Admin de la plataforma segun las propias reglas de Firestore: solo ellos pueden leer
 * platform_payments. Asi la lista de administradores vive en un solo lugar (las reglas).
 */
async function isPlatformAdmin(projectId: string, idToken: string): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${PLATFORM_PAYMENTS}?pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' } });
  return res.ok;
}

/** Empresa que el usuario puede pagar: la suya (ownerUid) o cualquiera si es admin de la plataforma. */
async function companyForPayer(
  admin: FirestoreAdmin,
  env: Env,
  companyId: string,
  claims: FirebaseClaims,
  token: string,
): Promise<FirestoreData | Response> {
  if (!ID_RE.test(companyId)) return json({ error: 'Invalid company.' }, 400);
  const company = await admin.get(`${COMPANIES}/${companyId}`);
  if (!company) return json({ error: 'Company not found.' }, 404);
  const isOwner = str(company.ownerUid) === claims.sub;
  if (!isOwner && !(await isPlatformAdmin(env.FIREBASE_PROJECT_ID, token))) {
    return json({ error: 'Only the company owner can manage the subscription.' }, 403);
  }
  return company;
}

const squareErrorResponse = (error: unknown, fallback: string): Response => {
  if (error instanceof SquareError) {
    console.error('Square error:', error.status, error.code, error.message);
    /* Los errores de tarjeta (rechazada, CVV, etc.) se muestran tal cual al usuario. */
    const status = error.status >= 400 && error.status < 500 ? 400 : 502;
    return json({ error: error.message, code: error.code }, status);
  }
  console.error(fallback, (error as Error).message);
  return json({ error: fallback }, 502);
};

/* ---------------- GET /api/billing/config ---------------- */

export function handleBillingConfig(env: Env): Response {
  if (!env.SQUARE_APPLICATION_ID || !env.SQUARE_LOCATION_ID) return json({ error: 'Payments are not configured.' }, 503);
  return json({
    applicationId: env.SQUARE_APPLICATION_ID,
    locationId: env.SQUARE_LOCATION_ID,
    environment: env.SQUARE_ENV === 'production' ? 'production' : 'sandbox',
  });
}

/* ---------------- POST /api/billing/sync-plans ---------------- */

interface CatalogObjectResponse {
  catalog_object?: { id: string };
}

async function createCatalogObject(square: SquareClient, object: Record<string, unknown>): Promise<string> {
  const data = await square.call<CatalogObjectResponse>('POST', '/catalog/object', {
    idempotency_key: crypto.randomUUID(),
    object,
  });
  const id = data.catalog_object?.id;
  if (!id) throw new Error('Square did not return the catalog object id');
  return id;
}

const createVariation = (square: SquareClient, planObjectId: string, name: string, cadence: 'MONTHLY' | 'ANNUAL', cents: number) =>
  createCatalogObject(square, {
    type: 'SUBSCRIPTION_PLAN_VARIATION',
    id: '#variation',
    subscription_plan_variation_data: {
      name,
      subscription_plan_id: planObjectId,
      phases: [{ cadence, ordinal: 0, pricing: { type: 'STATIC', price: { amount: cents, currency: 'USD' } } }],
    },
  });

/**
 * Crea en Square el plan y sus variaciones (mensual y anual) de cada plan con precio de
 * Plans & pricing. Square no deja cambiar el precio de una variacion: si el precio cambio se
 * crea una nueva y los clientes que ya pagan siguen con la anterior.
 */
export async function handleSyncPlans(request: Request, env: Env): Promise<Response> {
  const user = await signedInUser(request, env);
  if (user instanceof Response) return user;
  if (!(await isPlatformAdmin(env.FIREBASE_PROJECT_ID, user.token))) return json({ error: 'Only platform administrators.' }, 403);

  const admin = adminOf(env);
  const square = squareOf(env);
  const plans = await admin.list(PLATFORM_PLANS);
  const results: { planId: string; name: string; status: string }[] = [];

  try {
    for (const { id, data: plan } of plans) {
      const name = str(plan.name) || 'Plan';
      const monthlyPrice = num(plan.monthlyPrice);
      const annualMonthlyPrice = num(plan.annualMonthlyPrice);
      const billable = plan.active !== false && !str(plan.customPriceLabel).trim() && monthlyPrice >= 1;
      if (!billable) {
        results.push({ planId: id, name, status: 'Not billed online (custom price, hidden or $0)' });
        continue;
      }

      const map = ((await admin.get(`${BILLING_PLANS}/${id}`)) ?? {}) as BillingPlanMap;
      const next: BillingPlanMap = { ...map };
      const changes: string[] = [];

      if (!next.squarePlanId) {
        next.squarePlanId = await createCatalogObject(square, {
          type: 'SUBSCRIPTION_PLAN',
          id: '#plan',
          subscription_plan_data: { name: `Integrated Results — ${name}` },
        });
        changes.push('plan created');
      }

      const monthlyCents = toCents(monthlyPrice);
      if (!next.monthlyVariationId || next.monthlyAmount !== monthlyCents) {
        next.monthlyVariationId = await createVariation(square, next.squarePlanId, `${name} — Monthly`, 'MONTHLY', monthlyCents);
        next.monthlyAmount = monthlyCents;
        changes.push(`monthly $${monthlyPrice}`);
      }

      const annualCents = toCents(annualMonthlyPrice * 12);
      if (annualMonthlyPrice >= 1 && (!next.annualVariationId || next.annualAmount !== annualCents)) {
        next.annualVariationId = await createVariation(square, next.squarePlanId, `${name} — Annual`, 'ANNUAL', annualCents);
        next.annualAmount = annualCents;
        changes.push(`annual $${annualCents / 100}`);
      }
      if (annualMonthlyPrice < 1 && next.annualVariationId) {
        /* Sin opcion anual: no se ofrece mas (la variacion vieja sigue cobrando a quien ya la tiene). */
        next.annualVariationId = '';
        next.annualAmount = 0;
        changes.push('annual removed');
      }

      await admin.merge(`${BILLING_PLANS}/${id}`, { ...next, planName: name, syncedAt: new Date().toISOString() });
      results.push({ planId: id, name, status: changes.length ? `Updated: ${changes.join(', ')}` : 'Up to date' });
    }
  } catch (error) {
    return squareErrorResponse(error, 'The plans could not be synced with Square.');
  }
  return json({ results });
}

/* ---------------- POST /api/billing/subscribe ---------------- */

interface SubscribeBody {
  companyId?: unknown;
  planId?: unknown;
  cycle?: unknown;
  /** Token de un solo uso del formulario de tarjeta de Square (no es la tarjeta). */
  sourceId?: unknown;
  /** Token de verificacion del comprador (3-D Secure), si el SDK lo pidio. */
  verificationToken?: unknown;
}

/**
 * Guarda la tarjeta y crea la suscripcion. El primer cobro sale el dia despues de que termina
 * la prueba gratuita (o lo ya pagado); si eso ya paso, sale hoy.
 */
export async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const user = await signedInUser(request, env);
  if (user instanceof Response) return user;
  const body = await readBody<SubscribeBody>(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);

  const companyId = str(body.companyId);
  const planId = str(body.planId);
  const cycle = str(body.cycle) as Cycle;
  const sourceId = str(body.sourceId);
  if (!ID_RE.test(planId) || (cycle !== 'monthly' && cycle !== 'annual') || !sourceId) {
    return json({ error: 'Choose a plan, a billing cycle and enter a card.' }, 400);
  }

  const admin = adminOf(env);
  const company = await companyForPayer(admin, env, companyId, user.claims, user.token);
  if (company instanceof Response) return company;
  if (company.exempt === true) return json({ error: 'This company does not need a subscription.' }, 400);
  if (str(company.status) === 'Pending') return json({ error: 'The company has not been approved yet.' }, 400);
  const currentStatus = str(company.subscriptionStatus);
  if (str(company.squareSubscriptionId) && (currentStatus === 'ACTIVE' || currentStatus === 'PENDING') && !str(company.subscriptionCanceledDate)) {
    return json({ error: 'The company already has a subscription. Change the plan instead.' }, 409);
  }

  const map = (await admin.get(`${BILLING_PLANS}/${planId}`)) as BillingPlanMap | null;
  const variationId = cycle === 'annual' ? map?.annualVariationId : map?.monthlyVariationId;
  if (!variationId) return json({ error: 'This plan is not available for online payment yet.' }, 400);
  const amount = (cycle === 'annual' ? map?.annualAmount : map?.monthlyAmount) ?? 0;

  /* Primer cobro: despues de la prueba y de lo ya pagado, nunca antes de hoy. */
  const today = todayISO();
  const candidates = [today];
  if (isISODate(company.trialEndsAt)) candidates.push(addDaysISO(company.trialEndsAt, 1));
  if (isISODate(company.paidThrough)) candidates.push(addDaysISO(company.paidThrough, 1));
  const startDate = candidates.sort().pop() ?? today;

  const square = squareOf(env);
  try {
    let customerId = str(company.squareCustomerId);
    if (!customerId) {
      const created = await square.call<{ customer?: { id: string } }>('POST', '/customers', {
        idempotency_key: crypto.randomUUID(),
        company_name: str(company.name).slice(0, 255),
        email_address: user.claims.email ?? str(company.billingEmail),
        reference_id: companyId,
      });
      customerId = created.customer?.id ?? '';
      if (!customerId) throw new Error('Square did not return the customer id');
      await admin.merge(`${COMPANIES}/${companyId}`, { squareCustomerId: customerId });
    }

    const { card } = await square.call<{ card?: SquareCard }>('POST', '/cards', {
      idempotency_key: crypto.randomUUID(),
      source_id: sourceId,
      verification_token: str(body.verificationToken) || undefined,
      card: { customer_id: customerId, reference_id: companyId },
    });
    if (!card?.id) throw new Error('Square did not return the card id');

    const { subscription } = await square.call<{ subscription?: SquareSubscription }>('POST', '/subscriptions', {
      idempotency_key: crypto.randomUUID(),
      location_id: env.SQUARE_LOCATION_ID,
      plan_variation_id: variationId,
      customer_id: customerId,
      card_id: card.id,
      start_date: startDate,
      timezone: BILLING_TIMEZONE,
    });
    if (!subscription?.id) throw new Error('Square did not return the subscription id');

    const billing = {
      squareCardId: card.id,
      squareSubscriptionId: subscription.id,
      subscriptionPlanId: planId,
      subscriptionCycle: cycle,
      subscriptionAmount: amount / 100,
      subscriptionStatus: subscription.status ?? 'PENDING',
      subscriptionStartsAt: subscription.start_date ?? startDate,
      subscriptionCanceledDate: '',
      cardBrand: card.card_brand ?? '',
      cardLast4: card.last_4 ?? '',
      billingEmail: str(company.billingEmail) || user.claims.email || '',
    };
    await admin.merge(`${COMPANIES}/${companyId}`, billing);
    return json({ ok: true, ...billing });
  } catch (error) {
    return squareErrorResponse(error, 'The subscription could not be created. Try again.');
  }
}

/* ---------------- POST /api/billing/cancel ---------------- */

/** Cancela al final del periodo ya pagado: el acceso sigue hasta paidThrough. */
export async function handleCancel(request: Request, env: Env): Promise<Response> {
  const user = await signedInUser(request, env);
  if (user instanceof Response) return user;
  const body = await readBody<{ companyId?: unknown }>(request);
  const admin = adminOf(env);
  const company = await companyForPayer(admin, env, str(body?.companyId), user.claims, user.token);
  if (company instanceof Response) return company;
  const subscriptionId = str(company.squareSubscriptionId);
  if (!subscriptionId) return json({ error: 'The company has no subscription.' }, 400);

  try {
    const { subscription } = await squareOf(env).call<{ subscription?: SquareSubscription }>(
      'POST',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    );
    const update = {
      subscriptionStatus: subscription?.status ?? str(company.subscriptionStatus),
      subscriptionCanceledDate: subscription?.canceled_date ?? todayISO(),
    };
    await admin.merge(`${COMPANIES}/${str(body?.companyId)}`, update);
    return json({ ok: true, ...update });
  } catch (error) {
    return squareErrorResponse(error, 'The subscription could not be canceled. Try again.');
  }
}

/* ---------------- POST /api/billing/webhook ---------------- */

interface SquareEvent {
  event_id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

interface SquareInvoice {
  id?: string;
  subscription_id?: string;
  payment_requests?: { computed_amount_money?: { amount?: number }; total_completed_amount_money?: { amount?: number } }[];
}

async function companyBySubscription(admin: FirestoreAdmin, subscriptionId: string): Promise<{ id: string; data: FirestoreData } | null> {
  if (!subscriptionId) return null;
  const found = await admin.findByField(COMPANIES, 'squareSubscriptionId', subscriptionId, 1);
  return found[0] ?? null;
}

/** Cobro hecho: extiende el acceso hasta donde Square ya cobro y lo anota en el historial de ingresos. */
async function onInvoicePaid(admin: FirestoreAdmin, square: SquareClient, invoice: SquareInvoice): Promise<void> {
  const subscriptionId = invoice.subscription_id ?? '';
  const company = await companyBySubscription(admin, subscriptionId);
  if (!company || !invoice.id) {
    console.warn('Paid invoice without a known company:', invoice.id, subscriptionId);
    return;
  }
  const { subscription } = await square.call<{ subscription?: SquareSubscription }>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const annual = str(company.data.subscriptionCycle) === 'annual';
  const today = todayISO();
  /* charged_through_date = hasta donde ya esta cobrado; si no viene, se calcula por el ciclo. */
  const paidThrough = isISODate(subscription?.charged_through_date)
    ? subscription.charged_through_date
    : addDaysISO(today, annual ? 365 : 30);
  const request = invoice.payment_requests?.[0];
  const cents = request?.total_completed_amount_money?.amount ?? request?.computed_amount_money?.amount ?? 0;
  const amount = cents / 100;

  await admin.merge(`${COMPANIES}/${company.id}`, {
    paidThrough,
    lastPaymentAt: today,
    lastPaymentAmount: amount,
    lastPaymentFailedAt: '',
    subscriptionStatus: subscription?.status ?? 'ACTIVE',
  });
  /* El id del documento es el de la factura de Square: si Square reenvia el aviso, no se duplica. */
  await admin.merge(
    `${PLATFORM_PAYMENTS}/sq_${invoice.id.replace(/[^A-Za-z0-9_-]/g, '')}`,
    {
      companyId: company.id,
      companyName: str(company.data.name),
      amount,
      periods: annual ? 12 : 1,
      paidOn: today,
      paidThrough,
      recordedBy: 'Square',
      squareInvoiceId: invoice.id,
    },
    { createdAt: true },
  );
}

/** Webhook de Square: solo se procesa si la firma coincide con la Signature Key. */
export async function handleSquareWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-square-hmacsha256-signature') ?? '';
  const valid = await isValidSquareSignature(env.SQUARE_WEBHOOK_SIGNATURE_KEY, env.SQUARE_WEBHOOK_URL, rawBody, signature);
  if (!valid) return json({ error: 'Invalid signature.' }, 401);

  let event: SquareEvent;
  try {
    event = JSON.parse(rawBody) as SquareEvent;
  } catch {
    return json({ error: 'Invalid payload.' }, 400);
  }

  const admin = adminOf(env);
  const square = squareOf(env);
  const object = event.data?.object ?? {};
  try {
    switch (event.type) {
      case 'invoice.payment_made':
        await onInvoicePaid(admin, square, (object.invoice ?? {}) as SquareInvoice);
        break;
      case 'subscription.created':
      case 'subscription.updated': {
        const subscription = (object.subscription ?? {}) as SquareSubscription;
        const company = await companyBySubscription(admin, subscription.id ?? '');
        if (company) {
          await admin.merge(`${COMPANIES}/${company.id}`, {
            subscriptionStatus: subscription.status ?? str(company.data.subscriptionStatus),
            subscriptionCanceledDate: subscription.canceled_date ?? '',
          });
        }
        break;
      }
      case 'invoice.scheduled_charge_failed': {
        const invoice = (object.invoice ?? {}) as SquareInvoice;
        const company = await companyBySubscription(admin, invoice.subscription_id ?? '');
        if (company) await admin.merge(`${COMPANIES}/${company.id}`, { lastPaymentFailedAt: todayISO() });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    /* Un 500 hace que Square reintente el aviso mas tarde. */
    console.error('Square webhook failed:', event.type, event.event_id, (error as Error).message);
    return json({ error: 'Could not process the event.' }, 500);
  }
  return json({ ok: true });
}
