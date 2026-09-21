import type { CatalogOption } from '../../hooks/useCatalog';
import { CatalogSelect } from './CatalogSelect';
import { SearchableSelect } from './SearchableSelect';
import { COLLECTIONS } from '../../types/models';
import { useInventoryItems } from '../../hooks/useInventoryItems';
import { fmtMoney, round2, toNumber } from '../../utils/format';
import './LineItemsEditor.css';

/** Borrador de linea compartido por compras (BD_PURCHASEDETAILS) y ventas (BD_SALESORDERDETAIL). */
export interface LineDraft {
  id?: string;
  ID_COMMODITIES: string;
  ID_PURCHASEORDER?: string;
  DESCRIPTION?: string;
  QUANTITY: number;
  PRICE: number;
}

export const lineTotal = (line: LineDraft): number => round2(line.QUANTITY * line.PRICE);
export const sumLineTotals = (lines: LineDraft[]): number => round2(lines.reduce((acc, l) => acc + lineTotal(l), 0));
export const sumLineQuantities = (lines: LineDraft[]): number => round2(lines.reduce((acc, l) => acc + l.QUANTITY, 0));

export const emptyLine = (): LineDraft => ({ ID_COMMODITIES: '', QUANTITY: 0, PRICE: 0 });

interface LineItemsEditorProps {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  commodities: CatalogOption[];
  /** Si se pasa, cada linea muestra el select de orden de compra de origen (modo ventas). */
  purchaseOrders?: CatalogOption[];
  showDescription?: boolean;
  /** Descripcion del commodity en el catalogo: se autollena al seleccionarlo. */
  descriptionOf?: (commodityId: string) => string;
  /** Tope de cantidad por linea (modo ventas): disponible del lote. null = sin tope. */
  maxQtyFor?: (line: LineDraft, index: number) => number | null;
}

export function LineItemsEditor({
  lines,
  onChange,
  commodities,
  purchaseOrders,
  showDescription = false,
  descriptionOf,
  maxQtyFor,
}: LineItemsEditorProps) {
  /* Servicios y cargos (Temp Recorder, Freight...) no van amarrados a un lote. */
  const { tracksInventory } = useInventoryItems();
  const needsLot = (line: LineDraft): boolean => !line.ID_COMMODITIES || tracksInventory(line.ID_COMMODITIES);
  const capFor = (line: LineDraft, index: number): number | null =>
    maxQtyFor && needsLot(line) ? maxQtyFor(line, index) : null;

  const patch = (index: number, changes: Partial<LineDraft>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  };
  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));

  return (
    <div className="line-editor">
      <div className="line-editor__head">
        <h4 className="line-editor__title">Line items</h4>
        <button type="button" className="btn btn--secondary" onClick={() => onChange([...lines, emptyLine()])}>
          + Add line
        </button>
      </div>

      {lines.length === 0 && <p className="line-editor__empty">No lines yet. Add the first one.</p>}

      {lines.map((line, index) => (
        <div className="line-editor__row" key={line.id ?? `new-${index}`}>
          {purchaseOrders && (
            <div className="line-editor__po">
              {needsLot(line) ? (
                <SearchableSelect
                  value={line.ID_PURCHASEORDER ?? ''}
                  onChange={(id) => patch(index, { ID_PURCHASEORDER: id })}
                  options={purchaseOrders}
                  placeholder="Lot # (PO)…"
                />
              ) : (
                <span className="line-editor__no-lot">No lot needed</span>
              )}
            </div>
          )}
          <div className="line-editor__commodity">
            <CatalogSelect
              value={line.ID_COMMODITIES}
              onChange={(id) =>
                patch(index, {
                  ID_COMMODITIES: id,
                  DESCRIPTION: descriptionOf ? descriptionOf(id) : line.DESCRIPTION,
                  ...(purchaseOrders && id && !tracksInventory(id) ? { ID_PURCHASEORDER: '' } : {}),
                })
              }
              options={commodities}
              collection={COLLECTIONS.COMMODITIES}
              nameField="NAME_COMMODITIES"
              catalogLabel="commodity"
            />
          </div>
          {showDescription && (
            <input
              className="input line-editor__description"
              placeholder="Description"
              value={line.DESCRIPTION ?? ''}
              onChange={(e) => patch(index, { DESCRIPTION: e.target.value })}
            />
          )}
          <input
            className="input line-editor__qty"
            type="number"
            min="0"
            step="1"
            placeholder="Qty"
            value={line.QUANTITY || ''}
            max={capFor(line, index) ?? undefined}
            title={(() => {
              const cap = capFor(line, index);
              return cap !== null ? `Available on this lot: ${cap}` : undefined;
            })()}
            onChange={(e) => {
              /* Tope duro: nunca mas cantidad que la disponible en la Purchase Order. */
              const cap = capFor(line, index);
              const qty = toNumber(e.target.value);
              patch(index, { QUANTITY: cap !== null && qty > cap ? cap : qty });
            }}
          />
          <input
            className="input line-editor__price"
            type="number"
            min="0"
            step="0.01"
            placeholder="Price"
            value={line.PRICE || ''}
            onChange={(e) => patch(index, { PRICE: toNumber(e.target.value) })}
          />
          <span className="line-editor__total num">{fmtMoney(lineTotal(line))}</span>
          <button type="button" className="btn btn--icon line-editor__remove" onClick={() => remove(index)} aria-label="Remove line">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}

      {lines.length > 0 && (
        <div className="line-editor__summary">
          <span className="muted">Quantity: <b className="num">{sumLineQuantities(lines)}</b></span>
          <span className="muted">Subtotal: <b className="num">{fmtMoney(sumLineTotals(lines))}</b></span>
        </div>
      )}
    </div>
  );
}
