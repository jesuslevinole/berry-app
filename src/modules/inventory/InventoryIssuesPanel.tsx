import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCatalog } from '../../hooks/useCatalog';
import { useInventoryItems } from '../../hooks/useInventoryItems';
import { Modal } from '../../components/ui/Modal';
import { LineEditModal, type EditableLine } from '../../components/ui/RecordEditModals';
import { deleteDocument, updateDocument } from '../../services/firestore';
import { syncSalesOrderTotals } from '../../services/orderTotalsService';
import { COLLECTIONS, type BaseDoc, type PurchaseOrder, type SalesOrder, type SalesOrderDetail } from '../../types/models';
import type { InventoryIssue, IssueKind } from './inventoryLedger';
import '../../components/ui/InlineLineItems.css';
import './InventoryIssuesPanel.css';

interface Props {
  issues: InventoryIssue[];
  purchaseOrders: PurchaseOrder[];
  salesOrders: SalesOrder[];
  onOpenSale: (so: SalesOrder) => void;
  onOpenPurchase: (po: PurchaseOrder) => void;
  onClose: () => void;
}

/** Texto y orden de cada tipo de problema. */
const KIND_META: Record<IssueKind, { label: string; help: string; order: number }> = {
  'commodity-mismatch': {
    label: 'Wrong commodity',
    help: 'The sale line has a different commodity than its lot. Inventory already counts it as the lot’s commodity; fix the line so every report agrees.',
    order: 1,
  },
  'lot-oversold': {
    label: 'Lot oversold',
    help: 'Sales of this lot are more than what was purchased. Check the quantities or the lot chosen in those orders.',
    order: 2,
  },
  'commodity-not-in-lot': {
    label: 'Commodity not in lot',
    help: 'The lot has several commodities (or none) and none matches the sale line. Pick the right lot or commodity.',
    order: 3,
  },
  'sale-no-lot': {
    label: 'Sale without lot',
    help: 'The line has no lot, so it takes stock from the oldest lots. Assign the lot it really came from.',
    order: 4,
  },
  'sale-lot-missing': {
    label: 'Lot not found',
    help: 'The line points to a lot that no longer exists (deleted). Assign an existing lot.',
    order: 5,
  },
  'sale-no-order': {
    label: 'Orphan sales line',
    help: 'The line’s sales order no longer exists. It is ignored by the inventory; delete it.',
    order: 6,
  },
  'purchase-no-order': {
    label: 'Orphan purchase line',
    help: 'The line’s purchase order no longer exists. It is ignored by the inventory; delete it.',
    order: 7,
  },
};

type Filter = 'all' | IssueKind;

/**
 * Lista las lineas que hacen que Inventory no cuadre con Lot Activity y
 * permite corregirlas ahi mismo (una por una o todas las de producto equivocado).
 */
export function InventoryIssuesPanel({ issues, purchaseOrders, salesOrders, onOpenSale, onOpenPurchase, onClose }: Props) {
  const { can } = useAuth();
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { descriptionOf } = useInventoryItems();
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState('');
  const [fixingAll, setFixingAll] = useState(false);
  const [editingLine, setEditingLine] = useState<EditableLine | null>(null);

  const poById = useMemo(() => new Map(purchaseOrders.map((po) => [po.id, po])), [purchaseOrders]);
  const soById = useMemo(() => new Map(salesOrders.map((so) => [so.id, so])), [salesOrders]);
  const lotOptions = useMemo(
    () =>
      [...purchaseOrders]
        .sort((a, b) => (b.LOT_NUMBER ?? '').localeCompare(a.LOT_NUMBER ?? ''))
        .map((po) => ({ id: po.id, name: po.LOT_NUMBER || po.REF_NUMBER || '(PO without lot #)' })),
    [purchaseOrders],
  );

  const counts = useMemo(() => {
    const map = new Map<IssueKind, number>();
    for (const i of issues) map.set(i.kind, (map.get(i.kind) ?? 0) + 1);
    return map;
  }, [issues]);

  const rows = useMemo(
    () =>
      issues
        .filter((i) => filter === 'all' || i.kind === filter)
        .sort((a, b) => KIND_META[a.kind].order - KIND_META[b.kind].order),
    [issues, filter],
  );

  const mismatches = issues.filter((i) => i.kind === 'commodity-mismatch');
  const canEditSales = can('sales', 'edit');

  const lotLabel = (id: string): string => {
    if (!id) return '—';
    const po = poById.get(id);
    return po ? po.LOT_NUMBER || po.REF_NUMBER || '(no lot #)' : `${id} (deleted)`;
  };
  const orderLabel = (id: string): string => soById.get(id)?.SALES_ORDER_NUMBER || (id ? '(deleted order)' : '—');
  const lotHas = (issue: InventoryIssue): string =>
    issue.lotCommodityIds.length > 0 ? issue.lotCommodityIds.map((c) => commodities.labelOf(c)).join(', ') : '—';

  /** Pone en la linea el producto de su lote (y su descripcion del catalogo). */
  const applyFix = async (issue: InventoryIssue) => {
    await updateDocument<BaseDoc & Record<string, unknown>>(COLLECTIONS.SALES_ORDER_DETAIL, issue.lineId, {
      ID_COMMODITIES: issue.expectedCommodityId,
      DESCRIPTION: descriptionOf(issue.expectedCommodityId),
    });
  };

  const fixOne = async (issue: InventoryIssue) => {
    setBusyId(issue.id);
    try {
      await applyFix(issue);
    } catch {
      alert('The line could not be updated. Try again.');
    } finally {
      setBusyId('');
    }
  };

  const fixAll = async () => {
    if (!window.confirm(`Set the lot's commodity on ${mismatches.length} sales lines?`)) return;
    setFixingAll(true);
    let failed = 0;
    for (const issue of mismatches) {
      try {
        await applyFix(issue);
      } catch {
        failed += 1;
      }
    }
    setFixingAll(false);
    if (failed > 0) alert(`${failed} lines could not be updated. Try again.`);
  };

  const removeOrphan = async (issue: InventoryIssue) => {
    const isSale = issue.kind === 'sale-no-order';
    if (!window.confirm(`Delete this orphan ${isSale ? 'sales' : 'purchase'} line (${commodities.labelOf(issue.commodityId)}, qty ${issue.quantity})?`)) return;
    setBusyId(issue.id);
    try {
      await deleteDocument(isSale ? COLLECTIONS.SALES_ORDER_DETAIL : COLLECTIONS.PURCHASE_DETAILS, issue.lineId);
    } catch {
      alert('The line could not be deleted. Try again.');
    } finally {
      setBusyId('');
    }
  };

  /** Abre el editor de la linea (lote, producto, cantidad). */
  const editLine = (issue: InventoryIssue) => {
    if (issue.saleLine) setEditingLine(issue.saleLine);
  };

  const openOrder = (id: string) => {
    const so = soById.get(id);
    if (so) onOpenSale(so);
  };
  const openLot = (id: string) => {
    const po = poById.get(id);
    if (po) onOpenPurchase(po);
  };

  const actionFor = (issue: InventoryIssue) => {
    const busy = busyId === issue.id || fixingAll;
    switch (issue.kind) {
      case 'commodity-mismatch':
        return canEditSales ? (
          <button type="button" className="inline-lines__btn inline-lines__btn--save" disabled={busy} onClick={() => void fixOne(issue)}>
            Use {commodities.labelOf(issue.expectedCommodityId)}
          </button>
        ) : null;
      case 'commodity-not-in-lot':
      case 'sale-no-lot':
      case 'sale-lot-missing':
        return canEditSales ? (
          <button type="button" className="inline-lines__btn" disabled={busy} onClick={() => editLine(issue)}>
            Edit line
          </button>
        ) : null;
      case 'sale-no-order':
        return can('sales', 'delete') ? (
          <button type="button" className="inline-lines__btn inline-lines__btn--delete" disabled={busy} onClick={() => void removeOrphan(issue)}>
            Delete line
          </button>
        ) : null;
      case 'purchase-no-order':
        return can('purchases', 'delete') ? (
          <button type="button" className="inline-lines__btn inline-lines__btn--delete" disabled={busy} onClick={() => void removeOrphan(issue)}>
            Delete line
          </button>
        ) : null;
      case 'lot-oversold':
        return (
          <button type="button" className="inline-lines__btn" onClick={() => openLot(issue.purchaseOrderId)}>
            Open lot
          </button>
        );
      default:
        return null;
    }
  };

  const kinds = (Object.keys(KIND_META) as IssueKind[]).filter((k) => counts.has(k));

  return (
    <>
      <Modal title="Inventory data issues" open onClose={onClose} wide confirmOnClose={false}>
        <div className="inv-issues">
          <p className="inv-issues__hint">
            Inventory is calculated lot by lot, like Lot Activity: each sale takes from the lot on its line. These lines
            break that rule. Fixing them makes Inventory, Lot Activity and the reports agree.
          </p>

          {issues.length === 0 ? (
            <p className="inv-issues__ok">No issues found. Inventory and Lot Activity agree.</p>
          ) : (
            <>
              <div className="inv-issues__bar">
                <div className="inv-issues__filters">
                  <button
                    type="button"
                    className={`inv-issues__filter${filter === 'all' ? ' inv-issues__filter--active' : ''}`}
                    onClick={() => setFilter('all')}
                  >
                    All <b>{issues.length}</b>
                  </button>
                  {kinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`inv-issues__filter${filter === k ? ' inv-issues__filter--active' : ''}`}
                      onClick={() => setFilter(k)}
                    >
                      {KIND_META[k].label} <b>{counts.get(k)}</b>
                    </button>
                  ))}
                </div>
                {mismatches.length > 0 && canEditSales && (
                  <button type="button" className="btn btn--primary" disabled={fixingAll} onClick={() => void fixAll()}>
                    {fixingAll ? 'Fixing…' : `Fix all wrong commodities (${mismatches.length})`}
                  </button>
                )}
              </div>

              {filter !== 'all' && <p className="inv-issues__help">{KIND_META[filter].help}</p>}

              <div className="inv-issues__table-wrap">
                <table className="inv-issues__table">
                  <thead>
                    <tr>
                      <th className="inv-issues__th">Problem</th>
                      <th className="inv-issues__th"># Sales order</th>
                      <th className="inv-issues__th">Lot #</th>
                      <th className="inv-issues__th">Commodity on line</th>
                      <th className="inv-issues__th">Lot has</th>
                      <th className="inv-issues__th inv-issues__th--num">Qty</th>
                      <th className="inv-issues__th inv-issues__th--actions">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((issue) => (
                      <tr key={issue.id}>
                        <td className="inv-issues__td">
                          <span className={`inv-issues__badge inv-issues__badge--${issue.kind}`} title={KIND_META[issue.kind].help}>
                            {KIND_META[issue.kind].label}
                          </span>
                        </td>
                        <td className="inv-issues__td">
                          {issue.salesOrderId && soById.has(issue.salesOrderId) ? (
                            <button type="button" className="inventory__doclink" onClick={() => openOrder(issue.salesOrderId)}>
                              {orderLabel(issue.salesOrderId)}
                            </button>
                          ) : (
                            <span className="inv-issues__muted">{issue.kind === 'lot-oversold' ? '—' : orderLabel(issue.salesOrderId)}</span>
                          )}
                        </td>
                        <td className="inv-issues__td">
                          {issue.purchaseOrderId && poById.has(issue.purchaseOrderId) ? (
                            <button type="button" className="inventory__doclink" onClick={() => openLot(issue.purchaseOrderId)}>
                              {lotLabel(issue.purchaseOrderId)}
                            </button>
                          ) : (
                            <span className="inv-issues__muted">{lotLabel(issue.purchaseOrderId)}</span>
                          )}
                        </td>
                        <td className="inv-issues__td inv-issues__td--strong">{commodities.labelOf(issue.commodityId)}</td>
                        <td className="inv-issues__td">{lotHas(issue)}</td>
                        <td className="inv-issues__td inv-issues__td--num">
                          {issue.kind === 'lot-oversold' ? `−${issue.quantity}` : issue.quantity}
                        </td>
                        <td className="inv-issues__td inv-issues__td--actions">{actionFor(issue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      {editingLine && (
        <LineEditModal
          collection={COLLECTIONS.SALES_ORDER_DETAIL}
          line={editingLine}
          lotOptions={lotOptions}
          onClose={() => setEditingLine(null)}
          onSaved={() => {
            const parent = (editingLine as SalesOrderDetail).ID_SALESORDER;
            if (parent) void syncSalesOrderTotals([parent]);
          }}
        />
      )}
    </>
  );
}
