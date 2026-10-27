import { useEffect, useState } from 'react';
import { Toolbar } from '../../components/ui/Toolbar';
import {
  deletePlan,
  emptyPlanDraft,
  listPlans,
  saveExamplePlans,
  type PlanDraft,
} from '../../services/platformPlansService';
import { syncSquarePlans, type PlanSyncResult } from '../../services/squareBillingService';
import { fmtMoney } from '../../utils/format';
import type { PlatformPlan } from '../../types/models';
import { PlanCard } from '../landing/PlanCard';
import { PlanEditorModal } from './PlanEditorModal';
import './PlatformPlansView.css';

interface EditorState {
  plan: PlatformPlan | null;
  draft: PlanDraft;
}

const draftOf = (plan: PlatformPlan): PlanDraft => {
  const { id: _id, ...draft } = plan;
  void _id;
  return draft;
};

const priceSummary = (plan: PlatformPlan): string => {
  if (plan.customPriceLabel.trim()) return plan.customPriceLabel;
  const yearly = plan.annualMonthlyPrice > 0 ? ` · ${fmtMoney(plan.annualMonthlyPrice)}/mo yearly` : '';
  return `${fmtMoney(plan.monthlyPrice)}/mo${yearly}`;
};

/**
 * Planes y precios de la plataforma (seccion Pricing de la landing). Todo se edita
 * aqui: nombre, precios, caracteristicas, boton, plan destacado, orden y visibilidad.
 */
export const PlatformPlansView = () => {
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<PlanSyncResult[] | null>(null);

  const refreshPlans = async () => {
    try {
      setPlans(await listPlans());
    } catch {
      setError('Could not load the plans. Check your connection and try again.');
    }
  };

  /* Lectura puntual de la coleccion (diminuta). */
  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      try {
        const found = await listPlans();
        if (!cancelled) setPlans(found);
      } catch {
        if (!cancelled) setError('Could not load the plans. Check your connection and try again.');
      }
    };
    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, []);

  const nextOrder = (plans?.length ?? 0) + 1;

  const handleAdd = () => setEditor({ plan: null, draft: emptyPlanDraft(nextOrder) });
  const handleEdit = (plan: PlatformPlan) => setEditor({ plan, draft: draftOf(plan) });
  const handleCloseEditor = () => setEditor(null);
  const handleSaved = () => void refreshPlans();

  const handleLoadExamples = async () => {
    setBusy(true);
    try {
      await saveExamplePlans();
      await refreshPlans();
    } catch {
      setError('The example plans could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (plan: PlatformPlan) => {
    if (!window.confirm(`Delete the plan "${plan.name}"? It disappears from the landing page.`)) return;
    setBusy(true);
    try {
      await deletePlan(plan.id);
      await refreshPlans();
    } catch {
      setError('The plan could not be deleted. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /* Crea en Square (mensual y anual) los planes con precio; hay que hacerlo despues de cambiar precios. */
  const handleSyncSquare = async () => {
    setSyncing(true);
    setError(null);
    try {
      setSyncResults(await syncSquarePlans());
    } catch (e) {
      setError((e as Error).message || 'The plans could not be synced with Square.');
    } finally {
      setSyncing(false);
    }
  };

  const isEmpty = !!plans && plans.length === 0;

  return (
    <div className="platform-plans">
      <Toolbar title="Plans & pricing" subtitle="What the landing page shows in Pricing">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={syncing || isEmpty}
          title="Create the monthly and yearly prices in Square so companies can pay online"
          onClick={() => void handleSyncSquare()}
        >
          {syncing ? 'Syncing…' : 'Sync with Square'}
        </button>
        <button type="button" className="btn btn--primary" onClick={handleAdd}>
          + Add plan
        </button>
      </Toolbar>

      {error && <div className="platform-plans__error">{error}</div>}

      {syncResults && (
        <div className="platform-plans__sync">
          <p className="platform-plans__sync-title">Square</p>
          <ul className="platform-plans__sync-list">
            {syncResults.map((result) => (
              <li key={result.planId} className="platform-plans__sync-item">
                <b>{result.name}</b> — {result.status}
              </li>
            ))}
          </ul>
          <p className="platform-plans__sync-note">
            Sync again after changing a price: Square keeps current subscribers on their price and new ones get the new
            price.
          </p>
        </div>
      )}

      {isEmpty && (
        <div className="platform-plans__empty">
          <p className="platform-plans__empty-text">
            No plans saved yet, so the landing page shows three example plans (Starter, Business, Enterprise).
            Load them here to edit them, or create your own.
          </p>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void handleLoadExamples()}>
            Load example plans
          </button>
        </div>
      )}

      <div className="platform-plans__list">
        {plans?.map((plan) => (
          <section key={plan.id} className="platform-plans__item">
            <div className="platform-plans__preview">
              <PlanCard plan={plan} cycle="monthly" />
            </div>
            <div className="platform-plans__info">
              <h3 className="platform-plans__name">{plan.name}</h3>
              <p className="platform-plans__price">{priceSummary(plan)}</p>
              <p className="platform-plans__meta">
                Order {plan.order} · {plan.active ? 'Visible on the landing page' : 'Hidden'}
                {plan.highlighted ? ' · Highlighted' : ''}
              </p>
              <div className="platform-plans__actions">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => handleEdit(plan)}>
                  Edit
                </button>
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void handleDelete(plan)}>
                  Delete
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      {editor && (
        <PlanEditorModal plan={editor.plan} draft={editor.draft} onClose={handleCloseEditor} onSaved={handleSaved} />
      )}
    </div>
  );
};
