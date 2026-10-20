/**
 * Planes y precios de la plataforma (platform_plans, global). La landing los lee
 * sin sesion (las reglas permiten leerlos a cualquiera) y el Admin Panel los edita.
 * Coleccion diminuta: lecturas puntuales y escrituras directas.
 */
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type PlatformPlan } from '../types/models';

export type PlanDraft = Omit<PlatformPlan, 'id'>;

/** Planes de ejemplo: los muestra la landing mientras no haya planes guardados. */
export const EXAMPLE_PLANS: PlatformPlan[] = [
  {
    id: 'example-starter',
    name: 'Starter',
    tagline: 'For small teams getting organized.',
    monthlyPrice: 49,
    annualMonthlyPrice: 39,
    customPriceLabel: '',
    priceNote: 'per company / month',
    features: ['Up to 3 users', 'Purchase orders, sales and invoices', 'Accounts receivable and payable', 'Email support'],
    ctaLabel: 'Start free trial',
    highlighted: false,
    badge: '',
    active: true,
    order: 1,
  },
  {
    id: 'example-business',
    name: 'Business',
    tagline: 'Everything your operation needs in one place.',
    monthlyPrice: 99,
    annualMonthlyPrice: 79,
    customPriceLabel: '',
    priceNote: 'per company / month',
    features: [
      'Up to 10 users',
      'Everything in Starter',
      'Automated document delivery by email',
      'Checks, statements and liquidations',
      'Reports and analytics',
    ],
    ctaLabel: 'Start free trial',
    highlighted: true,
    badge: 'Most popular',
    active: true,
    order: 2,
  },
  {
    id: 'example-enterprise',
    name: 'Enterprise',
    tagline: 'For larger teams with custom needs.',
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    customPriceLabel: "Let's talk",
    priceNote: 'custom pricing',
    features: ['Unlimited users', 'Everything in Business', 'Data import and onboarding', 'Priority support'],
    ctaLabel: 'Request a demo',
    highlighted: false,
    badge: '',
    active: true,
    order: 3,
  },
];

export const emptyPlanDraft = (order: number): PlanDraft => ({
  name: '',
  tagline: '',
  monthlyPrice: 0,
  annualMonthlyPrice: 0,
  customPriceLabel: '',
  priceNote: 'per company / month',
  features: [],
  ctaLabel: 'Start free trial',
  highlighted: false,
  badge: '',
  active: true,
  order,
});

const byOrder = (a: PlatformPlan, b: PlatformPlan): number => a.order - b.order || a.name.localeCompare(b.name);

export const listPlans = async (): Promise<PlatformPlan[]> => {
  const snap = await getDocs(collection(db, COLLECTIONS.PLATFORM_PLANS));
  return snap.docs.map((d) => ({ ...emptyPlanDraft(0), id: d.id, ...d.data() }) as PlatformPlan).sort(byOrder);
};

/** Lo que muestra la landing: los planes activos, o los de ejemplo si aun no hay ninguno guardado. */
export const listPublicPlans = async (): Promise<PlatformPlan[]> => {
  try {
    const plans = await listPlans();
    return plans.length > 0 ? plans.filter((plan) => plan.active) : EXAMPLE_PLANS;
  } catch {
    return EXAMPLE_PLANS;
  }
};

export const savePlan = async (draft: PlanDraft, id?: string): Promise<void> => {
  const data = { ...draft, updatedAt: new Date().toISOString() };
  if (id) await setDoc(doc(db, COLLECTIONS.PLATFORM_PLANS, id), data);
  else await addDoc(collection(db, COLLECTIONS.PLATFORM_PLANS), data);
};

export const deletePlan = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS.PLATFORM_PLANS, id));
};

/** Guarda los planes de ejemplo como punto de partida para editarlos. */
export const saveExamplePlans = async (): Promise<void> => {
  for (const plan of EXAMPLE_PLANS) {
    const { id: _exampleId, ...draft } = plan;
    void _exampleId;
    await savePlan(draft);
  }
};
