import { useMemo } from 'react';
import { useCollection } from './useCollection';
import { COLLECTIONS, type BaseDoc } from '../types/models';

/** Commodity con su marca de inventario. */
export interface CommodityDoc extends BaseDoc {
  NAME_COMMODITIES?: string;
  DESCRIPTION_COMMODITIES?: string;
  /**
   * false = el producto NO lleva inventario ni va amarrado a un lote (PO):
   * servicios y cargos como Temp Recorder, Freight, Credit, Misc.
   * Sin valor = si lleva inventario (comportamiento de siempre).
   */
  TRACK_INVENTORY?: boolean;
}

/**
 * Marca de inventario de cada commodity, en vivo. Un producto lleva
 * inventario salvo que en su ficha diga TRACK_INVENTORY: false.
 */
export function useInventoryItems() {
  const { data: commodities, loading } = useCollection<CommodityDoc>(COLLECTIONS.COMMODITIES);

  const untracked = useMemo(
    () => new Set(commodities.filter((c) => c.TRACK_INVENTORY === false).map((c) => c.id)),
    [commodities],
  );

  /** true si el producto cuenta en inventario y va amarrado a un lote. */
  const tracksInventory = useMemo(() => (commodityId?: string): boolean => !!commodityId && !untracked.has(commodityId), [untracked]);

  return { commodities, loading, tracksInventory };
}
