import type { Company, PlatformPlan } from '../../types/models';
import { fmtDate, fmtMoney } from '../../utils/format';
import { hasFailedCharge, hasLiveSubscription } from '../../services/squareBillingService';
import './BillingStatusCard.css';

interface BillingStatusCardProps {
  company: Company;
  plan: PlatformPlan | undefined;
  canceling: boolean;
  onCancel: () => void;
}

/* Proximo cobro: antes de empezar, la fecha de inicio; despues, hasta donde ya esta pagado. */
const nextChargeOf = (company: Company): string =>
  company.subscriptionStatus === 'PENDING' ? company.subscriptionStartsAt ?? '' : company.paidThrough ?? '';

/** Suscripcion actual de la empresa: plan, proximo cobro, tarjeta y cancelar. */
export const BillingStatusCard = ({ company, plan, canceling, onCancel }: BillingStatusCardProps) => {
  const live = hasLiveSubscription(company);
  const canceled = !!company.subscriptionCanceledDate;
  const cycleLabel = company.subscriptionCycle === 'annual' ? 'year' : 'month';
  const statusLabel = canceled ? 'Canceled' : company.subscriptionStatus === 'PENDING' ? 'Starts after the trial' : 'Active';
  const statusClass = canceled ? 'billing-status__badge--off' : 'billing-status__badge--on';

  return (
    <section className="billing-status">
      <div className="billing-status__head">
        <div>
          <p className="billing-status__eyebrow">Current plan</p>
          <h3 className="billing-status__plan">{plan?.name ?? 'Subscription'}</h3>
        </div>
        <span className={`billing-status__badge ${statusClass}`}>{statusLabel}</span>
      </div>

      <dl className="billing-status__facts">
        <div className="billing-status__fact">
          <dt>Price</dt>
          <dd>
            {fmtMoney(company.subscriptionAmount ?? 0)} / {cycleLabel}
          </dd>
        </div>
        <div className="billing-status__fact">
          <dt>{canceled ? 'Access until' : 'Next charge'}</dt>
          <dd>{fmtDate(canceled ? company.paidThrough || company.subscriptionCanceledDate : nextChargeOf(company)) || '—'}</dd>
        </div>
        <div className="billing-status__fact">
          <dt>Card</dt>
          <dd>{company.cardLast4 ? `${company.cardBrand ?? 'Card'} •••• ${company.cardLast4}` : '—'}</dd>
        </div>
      </dl>

      {hasFailedCharge(company) && (
        <p className="billing-status__alert">
          The last automatic charge ({fmtDate(company.lastPaymentFailedAt)}) failed. Square will try again; if it keeps
          failing, contact us to update the card.
        </p>
      )}

      {canceled && (
        <p className="billing-status__note">
          The subscription was canceled. You keep access until the date above and you can subscribe again below.
        </p>
      )}

      {live && (
        <div className="billing-status__actions">
          <button type="button" className="btn btn--danger" disabled={canceling} onClick={onCancel}>
            {canceling ? 'Canceling…' : 'Cancel subscription'}
          </button>
        </div>
      )}
    </section>
  );
};
