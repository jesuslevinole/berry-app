import { useMemo } from 'react';
import { useCollection } from './useCollection';
import { catalogKeysOf } from './useCatalog';
import { COLLECTIONS, type BaseDoc } from '../types/models';

/** Commodity con su marca de inventario. */
export interface CommodityDoc extends BaseDoc {
  ID_COMMODITIES?: string;
  NAME_COMMODITIES?: string;
  DESCRIPTION_COMMODITIES?: string;
  /**
   * false = el producto NO lleva inventario ni va amarrado a un lote (PO):
   * servicios y cargos como Temp Recorder, Freight, Credit, Misc.
   * Sin valor = si lleva inventario (comportamiento de siempre).
   */
  TRACK_INVENTORY?: boolean;
  /**
   * false = el producto NO aparece en el resumen de arriba del Inventory
   * (solo visual: sigue contando y sus movimientos se ven igual).
   * Sin valor = se muestra.
   */
  SHOW_IN_INVENTORY?: boolean;
}

const normKey = (value: string): string => value.trim().toLowerCase();

/**
 * Marca de inventario y descripcion de cada commodity, en vivo. Un producto lleva
 * inventario salvo que en su ficha diga TRACK_INVENTORY: false.
 * Las lineas pueden referirse al commodity por el ID del documento o por el
 * ID_COMMODITIES de AppSheet guardado en el catalogo: ambos se resuelven.
 */
export function useInventoryItems() {
  const { data: commodities, loading } = useCollection<CommodityDoc>(COLLECTIONS.COMMODITIES);

  const byKey = useMemo(() => {
    const map = new Map<string, CommodityDoc>();
    for (const c of commodities) {
      for (const key of catalogKeysOf(c as CommodityDoc & Record<string, unknown>, 'ID_COMMODITIES')) map.set(key, c);
    }
    return map;
  }, [commodities]);

  const findCommodity = useMemo(
    () => (commodityId?: string): CommodityDoc | undefined => (commodityId ? byKey.get(normKey(commodityId)) : undefined),
    [byKey],
  );

  /** ID del documento del commodity (resuelve el ID_COMMODITIES de AppSheet); si no existe, el valor tal cual. */
  const canonicalId = useMemo(
    () => (commodityId?: string): string => findCommodity(commodityId)?.id ?? commodityId ?? '',
    [findCommodity],
  );

  /** true si el producto cuenta en inventario y va amarrado a un lote. */
  const tracksInventory = useMemo(
    () => (commodityId?: string): boolean => !!commodityId && findCommodity(commodityId)?.TRACK_INVENTORY !== false,
    [findCommodity],
  );

  /** true si el producto se muestra en el resumen de arriba del Inventory. */
  const showsInInventory = useMemo(
    () => (commodityId?: string): boolean => findCommodity(commodityId)?.SHOW_IN_INVENTORY !== false,
    [findCommodity],
  );

  /** Descripcion del catalogo de Commodities ('' si no tiene o no existe). */
  const descriptionOf = useMemo(
    () => (commodityId?: string): string => (findCommodity(commodityId)?.DESCRIPTION_COMMODITIES ?? '').trim(),
    [findCommodity],
  );

  /** Descripcion a mostrar en una linea: la del catalogo manda; la guardada en la linea es respaldo. */
  const lineDescription = useMemo(
    () => (line: { ID_COMMODITIES?: string; DESCRIPTION?: string }): string =>
      descriptionOf(line.ID_COMMODITIES) || (line.DESCRIPTION ?? '').trim(),
    [descriptionOf],
  );

  return { commodities, loading, tracksInventory, showsInInventory, canonicalId, descriptionOf, lineDescription };
}
