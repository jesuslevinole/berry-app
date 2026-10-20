import type { PlatformPlan } from '../../types/models';
import './PlanCard.css';

export type BillingCycle = 'monthly' | 'annual';

interface PlanCardProps {
  plan: PlatformPlan;
  cycle: BillingCycle;
  /** Accion del boton (registro o demo); sin ella el boton es solo una vista previa. */
  onSelect?: (plan: PlatformPlan) => void;
}

const formatPrice = (value: number): string =>
  `$${value.toLocaleString('en-US', { maximumFractionDigits: value % 1 === 0 ? 0 : 2 })}`;

/** Precio a mostrar segun el ciclo: el anual se ve como precio por mes. */
const priceOf = (plan: PlatformPlan, cycle: BillingCycle): number =>
  cycle === 'annual' && plan.annualMonthlyPrice > 0 ? plan.annualMonthlyPrice : plan.monthlyPrice;

/**
 * Tarjeta de un plan con el estilo de la landing (azul marino, acentos lima). La usan
 * la seccion Pricing y la vista previa del editor de planes en el Admin Panel.
 */
export const PlanCard = ({ plan, cycle, onSelect }: PlanCardProps) => {
  const hasCustomPrice = !!plan.customPriceLabel.trim();
  const annualNote = cycle === 'annual' && plan.annualMonthlyPrice > 0 ? ' · billed yearly' : '';

  const handleSelect = () => onSelect?.(plan);

  return (
    <article className={`plan-card${plan.highlighted ? ' plan-card--highlighted' : ''}`}>
      {plan.highlighted && plan.badge && <span className="plan-card__badge">{plan.badge}</span>}
      <h3 className="plan-card__name">{plan.name || 'Plan name'}</h3>
      <p className="plan-card__tagline">{plan.tagline}</p>
      <p className="plan-card__price">
        {hasCustomPrice ? plan.customPriceLabel : formatPrice(priceOf(plan, cycle))}
      </p>
      <p className="plan-card__note">
        {plan.priceNote}
        {!hasCustomPrice && annualNote}
      </p>
      <ul className="plan-card__features">
        {plan.features.map((feature) => (
          <li key={feature} className="plan-card__feature">
            <span className="plan-card__check" aria-hidden="true">&#10003;</span>
            {feature}
          </li>
        ))}
      </ul>
      <button type="button" className="plan-card__cta" onClick={handleSelect}>
        {plan.ctaLabel || 'Get started'}
      </button>
    </article>
  );
};
