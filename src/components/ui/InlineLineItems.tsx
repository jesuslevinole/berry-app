import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCatalog } from '../../hooks/useCatalog';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import type { BaseDoc } from '../../types/models';
import { SearchableSelect } from './SearchableSelect';
import { fmtMoney, round2, toNumber } from '../../utils/format';
import { COLLECTIONS } from '../../types/models';
import './InlineLineItems.css';

/** Linea generica de detalle (compras o ventas). */
export interface InlineLine {
  id: string;
  ID_COMMODITIES?: string;
  ID_PURCHASEORDER?: string;
  DESCRIPTION?: string;
  QUANTITY?: number;
  PRICE?: number;
  TOTAL?: number;
}

interface DraftLine {
  ID_COMMODITIES: string;
  ID_PURCHASEORDER: string;
  DESCRIPTION: string;
  QUANTITY: number;
  PRICE: number;
}

const emptyDraft = (lot = ''): DraftLine => ({
  ID_COMMODITIES: '',
  ID_PURCHASEORDER: lot,
  DESCRIPTION: '',
  QUANTITY: 0,
  PRICE: 0,
});

interface Props {
  /** Coleccion de detalles: BD_PURCHASEDETAILS o BD_SALESORDERDETAIL. */
  collection: string;
  /** Campo y valor que ligan la linea con su orden padre. */
  parentField: string;
  parentId: string;
  lines: InlineLine[];
  loading: boolean;
  /** Modulo para los permisos ('purchases' | 'sales'). */
  moduleId: string;
  /** Ventas: selector de lote por linea. */
  showLot?: boolean;
  lotOptions?: Array<{ id: string; name: string }>;
  /** Se llama tras cada alta, edicion o borrado para recalcular totales. */
  onChanged: () => void;
  /** Tope de cantidad disponible (ventas). null = sin tope. */
  maxQtyFor?: (line: { ID_PURCHASEORDER?: string; ID_COMMODITIES?: string }, excludeLineId?: string) => number | null;
}

/**
 * Tabla de lineas editable dentro del panel de detalle: agregar, editar y
 * eliminar productos sin abrir el formulario completo de la orden.
 */
export function InlineLineItems({
  collection,
  parentField,
  parentId,
  lines,
  loading,
  moduleId,
  showLot = false,
  lotOptions = [],
  onChanged,
  maxQtyFor,
}: Props) {
  const { can } = useAuth();
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');

  const [editingId, setEditingId] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftLine>(emptyDraft());
  const [busy, setBusy] = useState(false);

  const canEdit = can(moduleId, 'edit');
  const canDelete = can(moduleId, 'delete');
  const canAdd = can(moduleId, 'add') || canEdit;
  const columnCount = showLot ? 7 : 6;

  const startAdd = () => {
    setDraft(emptyDraft());
    setEditingId('');
    setAdding(true);
  };

  const startEdit = (line: InlineLine) => {
    setDraft({
      ID_COMMODITIES: line.ID_COMMODITIES ?? '',
      ID_PURCHASEORDER: line.ID_PURCHASEORDER ?? '',
      DESCRIPTION: line.DESCRIPTION ?? '',
      QUANTITY: line.QUANTITY ?? 0,
      PRICE: line.PRICE ?? 0,
    });
    setAdding(false);
    setEditingId(line.id);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId('');
  };

  /** Aplica el tope de disponibilidad del lote cuando corresponde (ventas). */
  const capFor = (excludeId?: string): number | null =>
    maxQtyFor ? maxQtyFor({ ID_PURCHASEORDER: draft.ID_PURCHASEORDER, ID_COMMODITIES: draft.ID_COMMODITIES }, excludeId) : null;

  const save = async () => {
    if (!draft.ID_COMMODITIES) {
      alert('Pick a commodity for this line.');
      return;
    }
    const cap = capFor(editingId || undefined);
    if (cap !== null && draft.QUANTITY > cap) {
      alert(`Quantity exceeds what is available on this lot (available: ${cap}).`);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        [parentField]: parentId,
        ID_COMMODITIES: draft.ID_COMMODITIES,
        DESCRIPTION: draft.DESCRIPTION.trim(),
        QUANTITY: draft.QUANTITY,
        PRICE: draft.PRICE,
        TOTAL: round2(draft.QUANTITY * draft.PRICE),
        ...(showLot ? { ID_PURCHASEORDER: draft.ID_PURCHASEORDER } : {}),
      };
      if (editingId) await updateDocument<BaseDoc & Record<string, unknown>>(collection, editingId, payload);
      else await createDocument<BaseDoc & Record<string, unknown>>(collection, payload as Omit<BaseDoc & Record<string, unknown>, 'id'>);
      cancel();
      onChanged();
    } catch {
      alert('The line could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (line: InlineLine) => {
    if (!window.confirm('Delete this line item?')) return;
    setBusy(true);
    try {
      await deleteDocument(collection, line.id);
      onChanged();
    } catch {
      alert('The line could not be deleted. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const draftRow = (key: string) => (
    <tr key={key} className="inline-lines__row--editing">
      <td className="record-detail__td inline-lines__actions">
        <button type="button" className="inline-lines__btn inline-lines__btn--save" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="inline-lines__btn" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </td>
      {showLot && (
        <td className="record-detail__td">
          <SearchableSelect
            value={draft.ID_PURCHASEORDER}
            onChange={(id) => setDraft((d) => ({ ...d, ID_PURCHASEORDER: id }))}
            options={lotOptions}
            placeholder="Lot\u2026"
          />
        </td>
      )}
      <td className="record-detail__td">
        <SearchableSelect
          value={draft.ID_COMMODITIES}
          onChange={(id) => setDraft((d) => ({ ...d, ID_COMMODITIES: id, DESCRIPTION: d.DESCRIPTION }))}
          options={commodities.options}
          placeholder="Commodity\u2026"
        />
      </td>
      <td className="record-detail__td">
        <input
          className="input"
          value={draft.DESCRIPTION}
          placeholder="Description"
          onChange={(e) => setDraft((d) => ({ ...d, DESCRIPTION: e.target.value }))}
        />
      </td>
      <td className="record-detail__td record-detail__td--num">
        <input
          className="input inline-lines__num"
          type="number"
          min="0"
          value={draft.QUANTITY || ''}
          placeholder="Qty"
          onChange={(e) => setDraft((d) => ({ ...d, QUANTITY: toNumber(e.target.value) }))}
        />
      </td>
      <td className="record-detail__td record-detail__td--num">
        <input
          className="input inline-lines__num"
          type="number"
          min="0"
          step="0.01"
          value={draft.PRICE || ''}
          placeholder="Price"
          onChange={(e) => setDraft((d) => ({ ...d, PRICE: toNumber(e.target.value) }))}
        />
      </td>
      <td className="record-detail__td record-detail__td--num record-detail__td--strong">
        {fmtMoney(round2(draft.QUANTITY * draft.PRICE))}
      </td>
    </tr>
  );

  return (
    <>
      {canAdd && !adding && !editingId && (
        <button type="button" className="btn btn--secondary inline-lines__add" onClick={startAdd}>
          + Add line
        </button>
      )}

      <div className="record-detail__table-wrap">
        <table className="record-detail__table">
          <thead>
            <tr>
              <th className="record-detail__th inline-lines__th-actions">Actions</th>
              {showLot && <th className="record-detail__th">Lot</th>}
              <th className="record-detail__th">Commodity</th>
              <th className="record-detail__th">Description</th>
              <th className="record-detail__th record-detail__th--num">Quantity</th>
              <th className="record-detail__th record-detail__th--num">Price</th>
              <th className="record-detail__th record-detail__th--num">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="record-detail__empty" colSpan={columnCount}>Loading\u2026</td></tr>}
            {!loading && lines.length === 0 && !adding && (
              <tr><td className="record-detail__empty" colSpan={columnCount}>No line items yet.</td></tr>
            )}
            {!loading &&
              lines.map((line) =>
                editingId === line.id ? (
                  draftRow(line.id)
                ) : (
                  <tr key={line.id}>
                    <td className="record-detail__td inline-lines__actions">
                      {canEdit && (
                        <button type="button" className="inline-lines__btn" disabled={busy} onClick={() => startEdit(line)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="inline-lines__btn inline-lines__btn--delete"
                          disabled={busy}
                          onClick={() => void remove(line)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                    {showLot && (
                      <td className="record-detail__td record-detail__td--muted">
                        {lotOptions.find((l) => l.id === line.ID_PURCHASEORDER)?.name || line.ID_PURCHASEORDER || '\u2014'}
                      </td>
                    )}
                    <td className="record-detail__td record-detail__td--strong">
                      {commodities.labelOf(line.ID_COMMODITIES)}
                    </td>
                    <td className="record-detail__td record-detail__td--muted">{line.DESCRIPTION || '\u2014'}</td>
                    <td className="record-detail__td record-detail__td--num">{line.QUANTITY ?? 0}</td>
                    <td className="record-detail__td record-detail__td--num">{fmtMoney(line.PRICE ?? 0)}</td>
                    <td className="record-detail__td record-detail__td--num record-detail__td--strong">
                      {fmtMoney(line.TOTAL ?? 0)}
                    </td>
                  </tr>
                ),
              )}
            {adding && draftRow('new-line')}
          </tbody>
        </table>
      </div>
    </>
  );
}
