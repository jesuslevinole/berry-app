import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { savePlan, type PlanDraft } from '../../services/platformPlansService';
import type { PlatformPlan } from '../../types/models';
import { PlanCard } from '../landing/PlanCard';
import './PlanEditorModal.css';

interface PlanEditorModalProps {
  /** Plan a editar; null = plan nuevo. */
  plan: PlatformPlan | null;
  draft: PlanDraft;
  onClose: () => void;
  onSaved: () => void;
}

const toNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Editor de un plan: todos los textos, precios, caracteristicas y orden. A la derecha,
 * la tarjeta tal como se vera en la landing. Se monta al abrirse (estado limpio).
 */
export const PlanEditorModal = ({ plan, draft: initialDraft, onClose, onSaved }: PlanEditorModalProps) => {
  const [draft, setDraft] = useState<PlanDraft>(initialDraft);
  const [featuresText, setFeaturesText] = useState(initialDraft.features.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (part: Partial<PlanDraft>) => setDraft((current) => ({ ...current, ...part }));

  /* Una caracteristica por linea; se guardan sin lineas vacias. */
  const handleFeaturesChange = (text: string) => {
    setFeaturesText(text);
    handleChange({ features: text.split('\n').map((line) => line.trim()).filter(Boolean) });
  };

  const handleToggleHighlighted = () => handleChange({ highlighted: !draft.highlighted });
  const handleToggleActive = () => handleChange({ active: !draft.active });

  const handleSave = async () => {
    if (!draft.name.trim()) {
      setError('The plan needs a name.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await savePlan({ ...draft, name: draft.name.trim() }, plan?.id);
      onSaved();
      onClose();
    } catch {
      setError('The plan could not be saved. Try again.');
      setSaving(false);
    }
  };

  const preview: PlatformPlan = { ...draft, id: plan?.id ?? 'preview' };

  return (
    <Modal
      title={plan ? `Edit plan · ${plan.name}` : 'New plan'}
      open
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </>
      }
    >
      <div className="plan-editor">
        <div className="plan-editor__form">
          <FormGrid>
            <FormField label="Plan name" required>
              <input className="input" value={draft.name} onChange={(e) => handleChange({ name: e.target.value })} />
            </FormField>
            <FormField label="Order on the page">
              <input
                className="input num"
                type="number"
                min="0"
                value={draft.order}
                onChange={(e) => handleChange({ order: toNumber(e.target.value) })}
              />
            </FormField>
            <FormField label="Short description" span2>
              <input className="input" value={draft.tagline} onChange={(e) => handleChange({ tagline: e.target.value })} />
            </FormField>
            <FormField label="Monthly price (USD)">
              <input
                className="input num"
                type="number"
                min="0"
                step="0.01"
                value={draft.monthlyPrice}
                onChange={(e) => handleChange({ monthlyPrice: toNumber(e.target.value) })}
              />
            </FormField>
            <FormField label="Yearly price, per month (0 = no yearly option)">
              <input
                className="input num"
                type="number"
                min="0"
                step="0.01"
                value={draft.annualMonthlyPrice}
                onChange={(e) => handleChange({ annualMonthlyPrice: toNumber(e.target.value) })}
              />
            </FormField>
            <FormField label="Text instead of price (optional)">
              <input
                className="input"
                placeholder="Let's talk"
                value={draft.customPriceLabel}
                onChange={(e) => handleChange({ customPriceLabel: e.target.value })}
              />
            </FormField>
            <FormField label="Note under the price">
              <input className="input" value={draft.priceNote} onChange={(e) => handleChange({ priceNote: e.target.value })} />
            </FormField>
            <FormField label="Features (one per line)" span2>
              <textarea
                className="input plan-editor__features"
                rows={6}
                value={featuresText}
                onChange={(e) => handleFeaturesChange(e.target.value)}
              />
            </FormField>
            <FormField label="Button text">
              <input className="input" value={draft.ctaLabel} onChange={(e) => handleChange({ ctaLabel: e.target.value })} />
            </FormField>
            <FormField label="Badge (highlighted plan)">
              <input
                className="input"
                placeholder="Most popular"
                value={draft.badge}
                onChange={(e) => handleChange({ badge: e.target.value })}
              />
            </FormField>
            <FormField label="Highlighted">
              <ToggleSwitch on={draft.highlighted} onToggle={handleToggleHighlighted} label="Highlighted plan" />
            </FormField>
            <FormField label="Visible on the landing page">
              <ToggleSwitch on={draft.active} onToggle={handleToggleActive} label="Visible on the landing page" />
            </FormField>
          </FormGrid>
          {error && <div className="plan-editor__error">{error}</div>}
        </div>

        <div className="plan-editor__preview">
          <p className="plan-editor__preview-label">Preview</p>
          <PlanCard plan={preview} cycle="monthly" />
        </div>
      </div>
    </Modal>
  );
};
