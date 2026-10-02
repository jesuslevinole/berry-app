import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Modal } from '../../components/ui/Modal';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { syncExpenseTotals, syncPurchaseOrderTotals, syncSalesOrderTotals } from '../../services/orderTotalsService';
import {
  COLLECTIONS,
  type BaseDoc,
  type Expense,
  type PaymentBill,
  type PaymentPurchase,
  type PaymentSales,
  type PurchaseOrder,
  type SalesOrder,
} from '../../types/models';
import { fmtDate, fmtMoney, todayISO } from '../../utils/format';
import { AREAS, auditPayments, type AuditArea, type AuditIssue, type AuditKind } from './paymentsAudit';
import '../../components/ui/InlineLineItems.css';
import './PaymentsAuditPanel.css';

interface Props {
  /** Area seleccionada al abrir ('all' = todas). */
  initialArea?: AuditArea | 'all';
  onClose: () => void;
}

const KIND_META: Record<AuditKind, { label: string; help: string; order: number }> = {
  'out-of-sync': {
    label: 'Paid out of sync',
    help: 'The document shows a paid amount different from the sum of its payments. "Sync" sets it to the sum of the payments.',
    order: 1,
  },
  'no-records': {
    label: 'Paid without records',
    help: 'The document says it was paid (usually in AppSheet) but has no payment records, so it does not show up in Payments. "Create record" adds one payment for that amount so every screen agrees.',
    order: 2,
  },
  orphan: {
    label: 'Orphan payment',
    help: 'The payment points to a document that does not exist. If a document with that number exists it can be linked; otherwise it can be deleted.',
    order: 3,
  },
  overpaid: {
    label: 'Overpaid',
    help: 'More was paid than the document total. Check the payments of that document.',
    order: 4,
  },
};

type AreaFilter = AuditArea | 'all';

/**
 * Revision de pagos: muestra todo lo que hace que los saldos no cuadren entre
 * Payments, los documentos y los reportes, y lo corrige con un clic.
 */
export function PaymentsAuditPanel({ initialArea = 'all', onClose }: Props) {
  const { can } = useAuth();
  const { data: salesOrders, loading: l1 } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: salesPayments, loading: l2 } = useCollection<PaymentSales>(COLLECTIONS.PAYMENT_SALES);
  const { data: purchaseOrders, loading: l3 } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: purchasePayments, loading: l4 } = useCollection<PaymentPurchase>(COLLECTIONS.PAYMENT_PURCHASE);
  const { data: expenses, loading: l5 } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const { data: billPayments, loading: l6 } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const loading = l1 || l2 || l3 || l4 || l5 || l6;

  const [area, setArea] = useState<AreaFilter>(initialArea);
  const [kind, setKind] = useState<AuditKind | 'all'>('all');
  const [busy, setBusy] = useState('');

  const issues = useMemo(
    () =>
      auditPayments({
        salesOrders,
        salesPayments,
        purchaseOrders,
        purchasePayments,
        expenses,
        billPayments,
        customerName: customers.nameOf,
        growerName: growers.nameOf,
        supplierName: suppliers.nameOf,
      }),
    [salesOrders, salesPayments, purchaseOrders, purchasePayments, expenses, billPayments, customers, growers, suppliers],
  );

  const inArea = issues.filter((i) => area === 'all' || i.area === area);
  const rows = inArea
    .filter((i) => kind === 'all' || i.kind === kind)
    .sort((a, b) => KIND_META[a.kind].order - KIND_META[b.kind].order || (a.date ?? '').localeCompare(b.date ?? ''));

  const countArea = (a: AreaFilter) => issues.filter((i) => a === 'all' || i.area === a).length;
  const countKind = (k: AuditKind) => inArea.filter((i) => i.kind === k).length;

  const moduleFor = (a: AuditArea): string => (a === 'sales' ? 'sales' : a === 'lots' ? 'purchases' : 'expenses');
  const canFix = (i: AuditIssue): boolean => can(moduleFor(i.area), 'edit');

  const syncParent = async (a: AuditArea, id: string) => {
    const opts = { paymentsChanged: true };
    if (a === 'sales') await syncSalesOrderTotals([id], true, opts);
    else if (a === 'lots') await syncPurchaseOrderTotals([id], true, opts);
    else await syncExpenseTotals([id], true, opts);
  };

  /** Aplica la correccion de un problema (sin confirmar: quien llama confirma). */
  const applyFix = async (i: AuditIssue) => {
    const meta = AREAS[i.area];
    if (i.kind === 'out-of-sync') {
      await syncParent(i.area, i.docId);
    } else if (i.kind === 'no-records') {
      await createDocument<BaseDoc & Record<string, unknown>>(meta.paymentCollection, {
        [meta.parentField]: i.docId,
        DATE: i.date || todayISO(),
        AMOUNT: i.storedPaid,
        ID_PAYMENTMETHOD: '',
        CHECK_NUMBER: '',
        REF_NUMBER: '',
        PHOTO: '',
        NOTE: 'Paid before the migration (record created by Check payments)',
      });
    } else if (i.kind === 'orphan' && i.relinkTo) {
      await updateDocument<BaseDoc & Record<string, unknown>>(meta.paymentCollection, i.paymentId, {
        [meta.parentField]: i.relinkTo,
      });
      await syncParent(i.area, i.relinkTo);
    }
  };

  const isFixable = (i: AuditIssue): boolean =>
    canFix(i) && (i.kind === 'out-of-sync' || i.kind === 'no-records' || (i.kind === 'orphan' && !!i.relinkTo));

  const fixOne = async (i: AuditIssue) => {
    setBusy(i.id);
    try {
      await applyFix(i);
    } catch {
      alert('Could not apply the fix. Try again.');
    } finally {
      setBusy('');
    }
  };

  const fixable = rows.filter(isFixable);
  const fixAll = async () => {
    if (!window.confirm(`Apply the fix to ${fixable.length} items?`)) return;
    setBusy('all');
    let failed = 0;
    for (const i of fixable) {
      try {
        await applyFix(i);
      } catch {
        failed += 1;
      }
    }
    setBusy('');
    if (failed > 0) alert(`${failed} items could not be fixed. Try again.`);
  };

  const removeOrphan = async (i: AuditIssue) => {
    if (!window.confirm(`Delete this orphan payment of ${fmtMoney(i.paymentAmount)}? It goes to the Recycle Bin.`)) return;
    setBusy(i.id);
    try {
      await deleteDocument(AREAS[i.area].paymentCollection, i.paymentId);
    } catch {
      alert('Could not delete the payment. Try again.');
    } finally {
      setBusy('');
    }
  };

  const actionFor = (i: AuditIssue) => {
    if (!canFix(i)) return null;
    const disabled = busy === i.id || busy === 'all';
    if (i.kind === 'out-of-sync')
      return <button type="button" className="inline-lines__btn inline-lines__btn--save" disabled={disabled} onClick={() => void fixOne(i)}>Sync</button>;
    if (i.kind === 'no-records')
      return <button type="button" className="inline-lines__btn inline-lines__btn--save" disabled={disabled} onClick={() => void fixOne(i)}>Create record</button>;
    if (i.kind === 'orphan' && i.relinkTo)
      return <button type="button" className="inline-lines__btn inline-lines__btn--save" disabled={disabled} onClick={() => void fixOne(i)}>Link to {i.relinkLabel}</button>;
    if (i.kind === 'orphan')
      return <button type="button" className="inline-lines__btn inline-lines__btn--delete" disabled={disabled} onClick={() => void removeOrphan(i)}>Delete</button>;
    return <span className="pay-audit__muted">Review</span>;
  };

  const areaTabs: AreaFilter[] = ['all', 'sales', 'lots', 'expenses'];
  const kinds = (Object.keys(KIND_META) as AuditKind[]).filter((k) => countKind(k) > 0);

  return (
    <Modal title="Check payments" open onClose={onClose} wide confirmOnClose={false}>
      <div className="pay-audit">
        <p className="pay-audit__hint">
          Compares every sales order, lot and expense with its payment records. When this list is empty, Payments,
          Sales Desk, Purchase Orders, Expenses and the AR / AP / A/P Growers reports all show the same amounts.
        </p>

        <div className="pay-audit__tabs">
          {areaTabs.map((a) => (
            <button
              key={a}
              type="button"
              className={`pay-audit__tab${area === a ? ' pay-audit__tab--active' : ''}`}
              onClick={() => {
                setArea(a);
                setKind('all');
              }}
            >
              {a === 'all' ? 'All' : AREAS[a].label} <b>{countArea(a)}</b>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="pay-audit__muted">Loading payments…</p>
        ) : inArea.length === 0 ? (
          <p className="pay-audit__ok">Everything matches. Every amount paid agrees with its payment records.</p>
        ) : (
          <>
            <div className="pay-audit__bar">
              <div className="pay-audit__filters">
                <button
                  type="button"
                  className={`pay-audit__filter${kind === 'all' ? ' pay-audit__filter--active' : ''}`}
                  onClick={() => setKind('all')}
                >
                  All <b>{inArea.length}</b>
                </button>
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`pay-audit__filter${kind === k ? ' pay-audit__filter--active' : ''}`}
                    onClick={() => setKind(k)}
                  >
                    {KIND_META[k].label} <b>{countKind(k)}</b>
                  </button>
                ))}
              </div>
              {fixable.length > 0 && (
                <button type="button" className="btn btn--primary" disabled={busy === 'all'} onClick={() => void fixAll()}>
                  {busy === 'all' ? 'Fixing…' : `Fix all (${fixable.length})`}
                </button>
              )}
            </div>

            {kind !== 'all' && <p className="pay-audit__help">{KIND_META[kind].help}</p>}

            <div className="pay-audit__table-wrap">
              <table className="pay-audit__table">
                <thead>
                  <tr>
                    <th className="pay-audit__th">Problem</th>
                    <th className="pay-audit__th">Document</th>
                    <th className="pay-audit__th">Party</th>
                    <th className="pay-audit__th">Date</th>
                    <th className="pay-audit__th pay-audit__th--num">Total</th>
                    <th className="pay-audit__th pay-audit__th--num">Paid (saved)</th>
                    <th className="pay-audit__th pay-audit__th--num">Payments</th>
                    <th className="pay-audit__th pay-audit__th--actions">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="pay-audit__td">
                        <span className={`pay-audit__badge pay-audit__badge--${i.kind}`} title={KIND_META[i.kind].help}>
                          {KIND_META[i.kind].label}
                        </span>
                      </td>
                      <td className="pay-audit__td pay-audit__td--strong">
                        <span className="pay-audit__area">{AREAS[i.area].label}</span>
                        {i.docLabel}
                      </td>
                      <td className="pay-audit__td">{i.party || '—'}</td>
                      <td className="pay-audit__td">{fmtDate(i.date)}</td>
                      <td className="pay-audit__td pay-audit__td--num">{i.kind === 'orphan' ? '—' : fmtMoney(i.total)}</td>
                      <td className="pay-audit__td pay-audit__td--num">{i.kind === 'orphan' ? '—' : fmtMoney(i.storedPaid)}</td>
                      <td className="pay-audit__td pay-audit__td--num">
                        {fmtMoney(i.kind === 'orphan' ? i.paymentAmount : i.paymentsSum)}
                      </td>
                      <td className="pay-audit__td pay-audit__td--actions">{actionFor(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
