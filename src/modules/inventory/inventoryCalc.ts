/**
 * Motor de calculo de inventario.
 *
 * Reglas de negocio (definidas con el cliente):
 *  - Cada linea de Purchase Order es una ENTRADA fisica al inventario.
 *  - Una linea de Sales Desk es:
 *      · COMMITTED  mientras la orden NO este cargada (Loaded = No): reservada,
 *        pero todavia dentro de la bodega.
 *      · SALIDA fisica cuando la orden se marca Loaded: sale de la bodega, baja
 *        el STOCK real y deja de estar comprometida.
 *  - Las ordenes canceladas no afectan el inventario.
 *
 *  STOCK      = entradas de compra  -  salidas ya cargadas (Loaded)
 *  COMMITTED  = lineas de venta comprometidas y aun no cargadas
 *  AVAILABLE  = STOCK - COMMITTED
 *
 * Ejemplo del cliente: entran 960; se venden 480 aun sin cargar -> Committed 480,
 * Stock 960, Available 480. Al marcar Loaded esas 480 salen -> Stock 480,
 * Committed 0, Available 480.
 */
import { round2 } from '../../utils/format';

export interface StockRow {
  commodityId: string;
  /** Existencia fisica real: entradas menos lo ya cargado. */
  stock: number;
  /** Reservado por ventas todavia no cargadas. */
  committed: number;
  /** Disponible para comprometer: stock - committed. */
  available: number;
}

export interface InEntry {
  commodityId: string;
  quantity: number;
}

export interface OutEntry {
  commodityId: string;
  quantity: number;
  /** La orden de venta ya fue cargada (salio de la bodega). */
  loaded: boolean;
}

export function buildStock(ins: InEntry[], outs: OutEntry[]): Map<string, StockRow> {
  const totals = new Map<string, { entries: number; loadedOut: number; committed: number }>();
  const ensure = (id: string) => {
    let entry = totals.get(id);
    if (!entry) {
      entry = { entries: 0, loadedOut: 0, committed: 0 };
      totals.set(id, entry);
    }
    return entry;
  };

  for (const line of ins) {
    if (!line.commodityId) continue;
    ensure(line.commodityId).entries += line.quantity;
  }

  for (const line of outs) {
    if (!line.commodityId) continue;
    const entry = ensure(line.commodityId);
    // Cargada => salida fisica que baja el stock. No cargada => comprometida.
    if (line.loaded) entry.loadedOut += line.quantity;
    else entry.committed += line.quantity;
  }

  const rows = new Map<string, StockRow>();
  for (const [commodityId, entry] of totals) {
    const stock = round2(entry.entries - entry.loadedOut);
    const committed = round2(entry.committed);
    rows.set(commodityId, {
      commodityId,
      stock,
      committed,
      available: round2(stock - committed),
    });
  }
  return rows;
}
