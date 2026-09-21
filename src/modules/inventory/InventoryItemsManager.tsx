import { useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { updateDocument } from '../../services/firestore';
import { useInventoryItems, type CommodityDoc } from '../../hooks/useInventoryItems';
import { COLLECTIONS } from '../../types/models';
import './InventoryItemsManager.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sin permiso solo se consulta, no se cambia. */
  canEdit: boolean;
}

/**
 * Decide, producto por producto, si lleva inventario y va amarrado a un lote.
 * Los que no (Temp Recorder, Freight, Credit...) desaparecen del inventario y
 * en ventas se agregan sin elegir lote.
 */
export function InventoryItemsManager({ open, onClose, canEdit }: Props) {
  const { commodities, tracksInventory } = useInventoryItems();
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...commodities]
      .filter((c) => !term || (c.NAME_COMMODITIES ?? '').toLowerCase().includes(term))
      .sort((a, b) => (a.NAME_COMMODITIES ?? '').localeCompare(b.NAME_COMMODITIES ?? ''));
  }, [commodities, search]);

  const trackedCount = commodities.filter((c) => tracksInventory(c.id)).length;

  const toggle = async (item: CommodityDoc) => {
    setSavingId(item.id);
    try {
      await updateDocument<CommodityDoc>(COLLECTIONS.COMMODITIES, item.id, { TRACK_INVENTORY: !tracksInventory(item.id) });
    } catch {
      alert('The product could not be updated. Try again.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <Modal title="Inventory products" open={open} onClose={onClose} confirmOnClose={false}>
      <div className="inv-items">
        <p className="inv-items__hint">
          Turn off the products that are services or charges (Temp Recorder, Freight, Credit…). They leave the
          inventory and, in sales, are added without choosing a lot.
        </p>

        <div className="inv-items__bar">
          <input
            className="input inv-items__search"
            value={search}
            placeholder="Search products…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="inv-items__count">
            {trackedCount} of {commodities.length} in inventory
          </span>
        </div>

        <div className="inv-items__list">
          {rows.length === 0 && <p className="inv-items__empty">No products match.</p>}
          {rows.map((item) => {
            const on = tracksInventory(item.id);
            return (
              <div key={item.id} className={`inv-items__row${on ? '' : ' inv-items__row--off'}`}>
                <div className="inv-items__info">
                  <span className="inv-items__name">{item.NAME_COMMODITIES || item.id}</span>
                  <span className="inv-items__desc">
                    {on ? 'Counts in inventory · tied to a lot (PO)' : 'Service / charge · not tied to a lot'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Track inventory for ${item.NAME_COMMODITIES ?? 'product'}`}
                  className={`inv-items__switch${on ? ' inv-items__switch--on' : ''}`}
                  disabled={!canEdit || savingId === item.id}
                  onClick={() => void toggle(item)}
                >
                  <span className="inv-items__knob" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
