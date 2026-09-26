import { useState } from 'react';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { useInventoryItems } from '../../hooks/useInventoryItems';
import { updateDocument } from '../../services/firestore';
import { COLLECTIONS, type BaseDoc } from '../../types/models';
import { fmtMoney, round2, todayISO, toNumber } from '../../utils/format';
import { confirmClose, Modal } from './Modal';
import { FormField, FormGrid } from './FormField';
import { SearchableSelect } from './SearchableSelect';
import './RecordEditModals.css';

type AnyDoc = BaseDoc & Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Linea de detalle (compras o ventas)                                 */
/* ------------------------------------------------------------------ */

export interface EditableLine {
  id: string;
  ID_COMMODITIES?: string;
  ID_PURCHASEORDER?: string;
  DESCRIPTION?: string;
  QUANTITY?: number;
  PRICE?: number;
}

interface LineEditModalProps {
  /** Coleccion de la linea: BD_PURCHASEDETAILS o BD_SALESORDERDETAIL. */
  collection: string;
  line: EditableLine;
  /** Si se pasa, se muestra el select de lote (modo ventas). */
  lotOptions?: CatalogOption[];
  onClose: () => void;
  /** Se llama despues de guardar, para recalcular los totales de la orden. */
  onSaved: () => void;
}

/**
 * Edicion de una sola linea desde las pestanas de detalle (Purchase / Sales details).
 * Mismas reglas que el editor inline: descripcion desde el catalogo y TOTAL = qty x price.
 */
export function LineEditModal({ collection, line, lotOptions, onClose, onSaved }: LineEditModalProps) {
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { tracksInventory, canonicalId, descriptionOf, lineDescription } = useInventoryItems();

  const [commodityId, setCommodityId] = useState(() => canonicalId(line.ID_COMMODITIES));
  const [lotId, setLotId] = useState(line.ID_PURCHASEORDER ?? '');
  const [description, setDescription] = useState(() => lineDescription(line));
  const [quantity, setQuantity] = useState(String(line.QUANTITY ?? 0));
  const [price, setPrice] = useState(String(line.PRICE ?? 0));
  const [busy, setBusy] = useState(false);

  const needsLot = !!lotOptions && (!commodityId || tracksInventory(commodityId));
  const total = round2(toNumber(quantity) * toNumber(price));

  const changeCommodity = (id: string) => {
    setCommodityId(id);
    setDescription(descriptionOf(id));
    if (id && !tracksInventory(id)) setLotId('');
  };

  const save = async () => {
    if (!commodityId) {
      alert('Select a commodity.');
      return;
    }
    if (needsLot && !lotId) {
      alert('Select the lot (PO) this line comes from.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        ID_COMMODITIES: commodityId,
        DESCRIPTION: description.trim(),
        QUANTITY: round2(toNumber(quantity)),
        PRICE: round2(toNumber(price)),
        TOTAL: total,
      };
      if (lotOptions) payload.ID_PURCHASEORDER = needsLot ? lotId : '';
      await updateDocument<AnyDoc>(collection, line.id, payload);
      onSaved();
      onClose();
    } catch {
      alert('The line could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit line item"
      open
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => confirmClose(onClose)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <FormGrid>
        {lotOptions && (
          <FormField label="Lot # (PO)" required={needsLot}>
            {needsLot ? (
              <SearchableSelect value={lotId} onChange={setLotId} options={lotOptions} placeholder="Lot # (PO)…" />
            ) : (
              <span className="record-edit__muted">No lot needed</span>
            )}
          </FormField>
        )}
        <FormField label="Commodity" required>
          <SearchableSelect
            value={commodityId}
            onChange={changeCommodity}
            options={commodities.options}
            placeholder="Commodity…"
          />
        </FormField>
        <FormField label="Description" span2>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="Quantity" required>
          <input className="input" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormField>
        <FormField label="Price" required>
          <input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </FormField>
      </FormGrid>
      <p className="record-edit__total">
        Line total <b className="num">{fmtMoney(total)}</b>
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Pago (ventas, lotes o gastos)                                       */
/* ------------------------------------------------------------------ */

export interface EditablePayment {
  id: string;
  DATE?: string;
  ID_PAYMENTMETHOD?: string;
  AMOUNT?: number;
  CHECK_NUMBER?: string;
  REF_NUMBER?: string;
  NOTE?: string;
}

interface PaymentEditModalProps {
  /** BD_PAYMENTSALES, BD_PAYMENTPURCHASE o BD_PAYMENTBILL. */
  collection: string;
  payment: EditablePayment;
  onClose: () => void;
  /** Se llama despues de guardar, para recalcular el saldo del documento padre. */
  onSaved: () => void;
}

/** Edicion de un pago desde la pestana Payments, sin abrir la orden. */
export function PaymentEditModal({ collection, payment, onClose, onSaved }: PaymentEditModalProps) {
  const methods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  const [date, setDate] = useState(payment.DATE || todayISO());
  const [methodId, setMethodId] = useState(() => methods.canonicalId(payment.ID_PAYMENTMETHOD));
  const [amount, setAmount] = useState(String(payment.AMOUNT ?? 0));
  const [checkNumber, setCheckNumber] = useState(payment.CHECK_NUMBER ?? '');
  const [refNumber, setRefNumber] = useState(payment.REF_NUMBER ?? '');
  const [note, setNote] = useState(payment.NOTE ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!toNumber(amount)) {
      alert('Enter the payment amount.');
      return;
    }
    setBusy(true);
    try {
      await updateDocument<AnyDoc>(collection, payment.id, {
        DATE: date,
        ID_PAYMENTMETHOD: methodId,
        AMOUNT: round2(toNumber(amount)),
        CHECK_NUMBER: checkNumber.trim(),
        REF_NUMBER: refNumber.trim(),
        NOTE: note.trim(),
      });
      onSaved();
      onClose();
    } catch {
      alert('The payment could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit payment"
      open
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => confirmClose(onClose)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <FormGrid>
        <FormField label="Date" required>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Method">
          <SearchableSelect value={methodId} onChange={setMethodId} options={methods.options} placeholder="Method…" />
        </FormField>
        <FormField label="Amount" required>
          <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Check #">
          <input className="input" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
        </FormField>
        <FormField label="Ref #">
          <input className="input" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} />
        </FormField>
        <FormField label="Note" span2>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </FormGrid>
    </Modal>
  );
}
