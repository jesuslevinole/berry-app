import { round2 } from '../../utils/format';
import type { PurchaseDetail, SalesOrder, SalesOrderDetail } from '../../types/models';

/**
 * Libro de inventario POR LOTE.
 *
 * Regla: una venta sale fisicamente del lote (PO) que indica su linea. Por eso
 * el inventario se calcula lote x producto, igual que Lot Activity:
 *   - Si el producto de la venta esta en su lote -> descuenta ese producto.
 *   - Si NO esta, pero el lote tiene un solo producto -> descuenta el producto
 *     del lote (es lo que salio del almacen) y se reporta como problema
 *     corregible con un clic ("commodity-mismatch").
 *   - Lineas sin orden (padre borrado) no cuentan y se reportan.
 */

export type IssueKind =
  | 'commodity-mismatch'
  | 'commodity-not-in-lot'
  | 'sale-no-lot'
  | 'sale-lot-missing'
  | 'sale-no-order'
  | 'purchase-no-order'
  | 'lot-oversold';

export interface InventoryIssue {
  id: string;
  kind: IssueKind;
  /** Linea afectada (vacio en lot-oversold). */
  lineId: string;
  salesOrderId: string;
  purchaseOrderId: string;
  /** Producto tal como esta guardado en la linea (ID canonico). */
  commodityId: string;
  /** Producto que deberia tener (el unico del lote), si se puede corregir solo. */
  expectedCommodityId: string;
  /** Productos que si tiene el lote. */
  lotCommodityIds: string[];
  quantity: number;
  /** Linea de venta original (para editarla), si aplica. */
  saleLine?: SalesOrderDetail;
}

export interface LedgerIn {
  lineId: string;
  lotId: string;
  commodityId: string;
  quantity: number;
}

export interface LedgerOut {
  line: SalesOrderDetail;
  /** Lote valido de la venta ('' si no tiene o no existe). */
  lotId: string;
  /** Producto que se descuenta del inventario. */
  commodityId: string;
  quantity: number;
  loaded: boolean;
}

export interface Ledger {
  ins: LedgerIn[];
  outs: LedgerOut[];
  issues: InventoryIssue[];
}

interface BuildArgs {
  purchaseDetails: PurchaseDetail[];
  purchaseOrderIds: Set<string>;
  salesDetails: SalesOrderDetail[];
  salesById: Map<string, SalesOrder>;
  canonicalId: (id?: string) => string;
  tracksInventory: (id?: string) => boolean;
  isLoaded: (so: SalesOrder) => boolean;
}

export function buildLedger({
  purchaseDetails,
  purchaseOrderIds,
  salesDetails,
  salesById,
  canonicalId,
  tracksInventory,
  isLoaded,
}: BuildArgs): Ledger {
  const issues: InventoryIssue[] = [];
  const issue = (partial: Partial<InventoryIssue> & Pick<InventoryIssue, 'id' | 'kind'>): void => {
    issues.push({
      lineId: '',
      salesOrderId: '',
      purchaseOrderId: '',
      commodityId: '',
      expectedCommodityId: '',
      lotCommodityIds: [],
      quantity: 0,
      ...partial,
    });
  };

  /* ---- Entradas ---- */
  const ins: LedgerIn[] = [];
  const lotCommodities = new Map<string, Set<string>>();
  for (const line of purchaseDetails) {
    if (!line.ID_COMMODITIES || !tracksInventory(line.ID_COMMODITIES)) continue;
    const commodityId = canonicalId(line.ID_COMMODITIES);
    const quantity = round2(line.QUANTITY ?? 0);
    if (!purchaseOrderIds.has(line.ID_PURCHASEORDER)) {
      issue({
        id: `pnoorder-${line.id}`,
        kind: 'purchase-no-order',
        lineId: line.id,
        purchaseOrderId: line.ID_PURCHASEORDER ?? '',
        commodityId,
        quantity,
      });
      continue;
    }
    ins.push({ lineId: line.id, lotId: line.ID_PURCHASEORDER, commodityId, quantity });
    const set = lotCommodities.get(line.ID_PURCHASEORDER) ?? new Set<string>();
    set.add(commodityId);
    lotCommodities.set(line.ID_PURCHASEORDER, set);
  }

  /* ---- Salidas (despachadas y comprometidas) ---- */
  const outs: LedgerOut[] = [];
  for (const line of salesDetails) {
    if (!line.ID_COMMODITIES || !tracksInventory(line.ID_COMMODITIES)) continue;
    const lineCommodity = canonicalId(line.ID_COMMODITIES);
    const quantity = round2(line.QUANTITY ?? 0);
    const base = {
      lineId: line.id,
      salesOrderId: line.ID_SALESORDER ?? '',
      purchaseOrderId: line.ID_PURCHASEORDER ?? '',
      commodityId: lineCommodity,
      quantity,
      saleLine: line,
    };

    const so = salesById.get(line.ID_SALESORDER);
    if (!so) {
      issue({ id: `snoorder-${line.id}`, kind: 'sale-no-order', ...base });
      continue;
    }
    if (so.STATUS === 'Cancelled') continue;

    const rawLot = line.ID_PURCHASEORDER ?? '';
    const lotSet = rawLot ? lotCommodities.get(rawLot) : undefined;
    let lotId = '';
    let commodityId = lineCommodity;

    if (!rawLot) {
      issue({ id: `snolot-${line.id}`, kind: 'sale-no-lot', ...base });
    } else if (!purchaseOrderIds.has(rawLot)) {
      issue({ id: `slotmissing-${line.id}`, kind: 'sale-lot-missing', ...base });
    } else {
      lotId = rawLot;
      const lotIds = [...(lotSet ?? [])];
      if (lotSet && !lotSet.has(lineCommodity)) {
        if (lotIds.length === 1) {
          /* Lo que salio del almacen es el producto del lote. */
          commodityId = lotIds[0];
          issue({
            id: `mismatch-${line.id}`,
            kind: 'commodity-mismatch',
            ...base,
            expectedCommodityId: lotIds[0],
            lotCommodityIds: lotIds,
          });
        } else {
          issue({ id: `notinlot-${line.id}`, kind: 'commodity-not-in-lot', ...base, lotCommodityIds: lotIds });
        }
      } else if (!lotSet) {
        /* El lote existe pero no tiene lineas de producto con inventario. */
        issue({ id: `notinlot-${line.id}`, kind: 'commodity-not-in-lot', ...base, lotCommodityIds: [] });
      }
    }

    outs.push({ line, lotId, commodityId, quantity, loaded: isLoaded(so) });
  }

  /* ---- Lotes sobrevendidos (lote x producto) ---- */
  const balance = new Map<string, number>();
  const key = (lotId: string, commodityId: string): string => `${lotId}|${commodityId}`;
  for (const entry of ins) balance.set(key(entry.lotId, entry.commodityId), round2((balance.get(key(entry.lotId, entry.commodityId)) ?? 0) + entry.quantity));
  for (const out of outs) {
    if (!out.lotId) continue;
    const k = key(out.lotId, out.commodityId);
    balance.set(k, round2((balance.get(k) ?? 0) - out.quantity));
  }
  for (const [k, value] of balance) {
    if (value >= 0) continue;
    const [lotId, commodityId] = k.split('|');
    issue({ id: `oversold-${k}`, kind: 'lot-oversold', purchaseOrderId: lotId, commodityId, quantity: round2(-value) });
  }

  return { ins, outs, issues };
}

/* ------------------------------------------------------------------ */
/* Asignacion por lote para el desglose de cada numero del inventario  */
/* ------------------------------------------------------------------ */

export interface AllocEntry<T> {
  row: T;
  lotId: string;
  date: string;
  quantity: number;
}

/**
 * Cada venta consume SU lote. Las ventas sin lote valido consumen los lotes mas
 * antiguos (FIFO). Invariante: suma(remaining) - suma(excess) = entradas - salidas.
 */
export function allocateByLot<TIn, TOut>(entries: AllocEntry<TIn>[], exits: AllocEntry<TOut>[]): {
  remaining: { row: TIn; qty: number }[];
  excess: { row: TOut; qty: number }[];
} {
  const byDate = <T extends { date: string }>(a: T, b: T): number => (a.date ?? '').localeCompare(b.date ?? '');
  const queue = [...entries]
    .filter((e) => e.quantity > 0)
    .sort(byDate)
    .map((e) => ({ row: e.row, lotId: e.lotId, qty: e.quantity }));
  const excess: { row: TOut; qty: number }[] = [];

  const consume = (slots: typeof queue, need: number): number => {
    for (const slot of slots) {
      if (need <= 0) break;
      if (slot.qty <= 0) continue;
      const take = Math.min(slot.qty, need);
      slot.qty = round2(slot.qty - take);
      need = round2(need - take);
    }
    return need;
  };

  /* Entradas negativas (ajustes de compra): restan de su propio lote. */
  for (const entry of entries.filter((e) => e.quantity < 0)) {
    consume(queue.filter((s) => s.lotId === entry.lotId), -entry.quantity);
  }

  const sortedExits = [...exits].sort(byDate);
  /* Primero las ventas amarradas a su lote; luego las que no tienen lote. */
  for (const exit of sortedExits.filter((e) => e.lotId)) {
    if (exit.quantity < 0) {
      /* Credito / devolucion: regresa al lote. */
      const slot = queue.find((s) => s.lotId === exit.lotId);
      if (slot) slot.qty = round2(slot.qty - exit.quantity);
      continue;
    }
    const left = consume(queue.filter((s) => s.lotId === exit.lotId), exit.quantity);
    if (left > 0) excess.push({ row: exit.row, qty: left });
  }
  for (const exit of sortedExits.filter((e) => !e.lotId)) {
    if (exit.quantity < 0) continue;
    const left = consume(queue, exit.quantity);
    if (left > 0) excess.push({ row: exit.row, qty: left });
  }

  return { remaining: queue.filter((s) => s.qty > 0).map(({ row, qty }) => ({ row, qty })), excess };
}
