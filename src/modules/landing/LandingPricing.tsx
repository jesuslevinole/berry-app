import { useEffect, useState } from 'react';
import { DEMO_REQUEST_URL } from '../../config/platformBrand';
import { goToPublicPage } from '../../hooks/usePublicPage';
import { listPublicPlans } from '../../services/platformPlansService';
import { TRIAL_DAYS } from '../../services/trialLimits';
import type { PlatformPlan } from '../../types/models';
import { PlanCard, type BillingCycle } from './PlanCard';
import { Reveal } from './Reveal';
import './LandingPricing.css';

/** Plan con precio personalizado: su boton lleva a pedir un demo; los demas, al registro. */
const handlePlanSelect = (plan: PlatformPlan) => {
  if (plan.customPriceLabel.trim()) window.location.href = DEMO_REQUEST_URL;
  else goToPublicPage('signup');
};

/**
 * Seccion "Pricing" de la landing. Los planes se editan en el Admin Panel; mientras
 * no haya ninguno guardado se muestran los de ejemplo.
 */
export const LandingPricing = () => {
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  /* Lectura puntual de los planes (publicos, sin sesion). */
  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      const found = await listPublicPlans();
      if (!cancelled) setPlans(found);
    };
    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!plans || plans.length === 0) return null;

  const hasAnnual = plans.some((plan) => plan.annualMonthlyPrice > 0 && !plan.customPriceLabel.trim());
  const handleMonthly = () => setCycle('monthly');
  const handleAnnual = () => setCycle('annual');

  return (
    <section id="pricing" className="landing-pricing">
      <div className="landing-pricing__container">
        <Reveal>
          <p className="landing-pricing__eyebrow">Pricing</p>
          <h2 className="landing-pricing__title">
            Simple plans for <span className="landing-pricing__lime">every stage</span>
          </h2>
          <p className="landing-pricing__text">
            Every plan starts with a {TRIAL_DAYS}-day free trial. No card required.
          </p>
        </Reveal>

        {hasAnnual && (
          <div className="landing-pricing__toggle" role="group" aria-label="Billing cycle">
            <button
              type="button"
              className={`landing-pricing__cycle${cycle === 'monthly' ? ' landing-pricing__cycle--on' : ''}`}
              aria-pressed={cycle === 'monthly'}
              onClick={handleMonthly}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`landing-pricing__cycle${cycle === 'annual' ? ' landing-pricing__cycle--on' : ''}`}
              aria-pressed={cycle === 'annual'}
              onClick={handleAnnual}
            >
              Yearly
            </button>
          </div>
        )}

        <div className="landing-pricing__grid">
          {plans.map((plan, index) => (
            <Reveal key={plan.id} delay={index * 120}>
              <PlanCard plan={plan} cycle={cycle} onSelect={handlePlanSelect} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
};
