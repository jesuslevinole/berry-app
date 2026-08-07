import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { where } from 'firebase/firestore';
import { useCatalog } from '../../hooks/useCatalog';
import { useCollection } from '../../hooks/useCollection';
import { isAutoLot, nextLotForGrower } from '../../services/lotNumberService';
import { createDocument, listDocuments, replaceChildren, updateDocument, deleteDocument } from '../../services/firestore';
import { COLLECTIONS, type PurchaseDetail, type PurchaseOrder } from '../../types/models';
import { fmtMoney, round2, todayISO, toNumber } from '../../utils/format';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import {
  LineItemsEditor,
  lineTotal,
  sumLineQuantities,
  sumLineTotals,
  type LineDraft,
} from '../../components/ui/LineItemsEditor';
import './PurchaseOrderForm.css';

interface PurchaseOrderFormProps {
  open: boolean;
  initial: PurchaseOrder | null;
  onClose: () => void;
}

export function PurchaseOrderForm({ open, initial, onClose }: PurchaseOrderFormProps) {
  const { can } = useAuth();
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const { data: growerDocs } = useCollection<{ id: string; PREFIX_GROWER?: string }>(COLLECTIONS.GROWER);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const users = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');

  const [lotNumber, setLotNumber] = useState('');
  /** true mientras el Lot # es autogenerado (se recalcula al guardar); false si el usuario lo edito a mano. */
  const [lotAuto, setLotAuto] = useState(false);
  const [refNumber, setRefNumber] = useState('');
  const [arrivalDate, setArrivalDate] = useState(todayISO());
  const [growerId, setGrowerId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [userId, setUserId] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [commissionPercent, setCommissionPercent] = useState('0');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);

  /* Sugerir Lot # = PREFIX del grower + consecutivo (solo al crear). */
  useEffect(() => {
    if (!open || initial) return;
    const prefix = (growerDocs.find((g) => g.id === growerId)?.PREFIX_GROWER ?? '').trim();
    if (!growerId || !prefix) return;
    let cancelled = false;
    void nextLotForGrower(growerId, prefix).then((suggested) => {
      if (!cancelled) {
        setLotNumber(suggested);
        setLotAuto(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, growerId, growerDocs]);

  useEffect(() => {
    if (!open) return;
    setLotNumber(initial?.LOT_NUMBER ?? '');
    setLotAuto(false);
    setRefNumber(initial?.REF_NUMBER ?? '');
    setArrivalDate(initial?.ARRIVAL_DATE ?? todayISO());
    setGrowerId(initial?.ID_GROWER ?? '');
    setCustomerId(initial?.ID_CUSTOMER ?? '');
    setUserId(initial?.ID_USERS ?? '');
    setCarrierId(initial?.ID_CARRIER ?? '');
    setShipTo(initial?.SHIPTO ?? '');
    setCommissionPercent(String(initial?.COMMISION_PERCENT ?? 0));
    setNote(initial?.NOTE ?? '');
    setLines([]);
    if (initial) {
      void listDocuments<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS, [
        where('ID_PURCHASEORDER', '==', initial.id),
      ]).then((details) =>
        setLines(
          details.map((d) => ({
            id: d.id,
            ID_COMMODITIES: d.ID_COMMODITIES,
            QUANTITY: d.QUANTITY,
            PRICE: d.PRICE,
          })),
        ),
      );
    }
  }, [open, initial]);

  const subtotal = useMemo(() => sumLineTotals(lines), [lines]);
  const quantity = useMemo(() => sumLineQuantities(lines), [lines]);
  const commissionAmount = useMemo(
    () => round2((subtotal * toNumber(commissionPercent)) / 100),
    [subtotal, commissionPercent],
  );
  const total = useMemo(() => round2(subtotal + commissionAmount), [subtotal, commissionAmount]);

  /** Cierre inmediato: encabezado + detalle se guardan en segundo plano (local-first). */
  const handleSave = () => {
    const amountPaid = initial?.AMOUNT_PAID ?? 0;
      const payload: Omit<PurchaseOrder, 'id'> = {
        LOT_NUMBER: lotNumber.trim(),
        ID_GROWER: growerId,
        ID_CUSTOMER: customerId,
        SHIPTO: shipTo,
        ID_USERS: userId,
        ID_CARRIER: carrierId,
        NOTE: note.trim(),
        COMMISION_PERCENT: toNumber(commissionPercent),
        REF_NUMBER: refNumber.trim(),
        ARRIVAL_DATE: arrivalDate,
        SUBTOTAL: subtotal,
        COMMISION_AMOUNT: commissionAmount,
        EXPENSES: initial?.EXPENSES ?? 0,
        TOTAL_EXPENSES: initial?.TOTAL_EXPENSES ?? 0,
        TOTAL: total,
        AMOUNT_PAID: amountPaid,
        BALANCE: round2(total - amountPaid),
        QUANTITY: quantity,
      };
      const detailRows = lines.map((line) => ({
        id: line.id,
        ID_COMMODITIES: line.ID_COMMODITIES,
        QUANTITY: line.QUANTITY,
        PRICE: line.PRICE,
        TOTAL: lineTotal(line),
      }));
      const editingId = initial?.id ?? null;
      onClose();

      const growerPrefix = (growerDocs.find((g) => g.id === payload.ID_GROWER)?.PREFIX_GROWER ?? '').trim();
      const confirmLot = lotAuto && !editingId && !!growerPrefix;
      const persist = async () => {
        /* Confirmacion final del consecutivo: re-consultar el maximo por si otra PO
           se creo despues de la sugerencia (no repetir ni saltar numeros). */
        if (confirmLot && isAutoLot(payload.LOT_NUMBER, growerPrefix)) {
          payload.LOT_NUMBER = await nextLotForGrower(payload.ID_GROWER, growerPrefix);
        }
        const orderId = editingId
          ? (await updateDocument<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, editingId, payload), editingId)
          : await createDocument<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, payload);
        await replaceChildren(COLLECTIONS.PURCHASE_DETAILS, 'ID_PURCHASEORDER', orderId, detailRows);
      };
      persist().catch((error: unknown) =>
        alert(`Failed to save purchase order: ${(error as Error).message ?? 'Unknown error'}`),
      );
  };

  const handleDelete = () => {
    if (!initial) return;
    if (!window.confirm(`Delete purchase order ${initial.LOT_NUMBER || initial.REF_NUMBER}?`)) return;
    const orderId = initial.id;
    onClose();
    const persist = async () => {
      await replaceChildren(COLLECTIONS.PURCHASE_DETAILS, 'ID_PURCHASEORDER', orderId, []);
      await deleteDocument(COLLECTIONS.PURCHASE_ORDER, orderId);
    };
    persist().catch((error: unknown) =>
      alert(`Failed to delete purchase order: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <Modal
      title={initial ? `Edit purchase order ${initial.LOT_NUMBER}` : 'New purchase order'}
      open={open}
      onClose={onClose}
      wide
      footer={
        <>
          {initial && can('purchases', 'delete') && (
            <button type="button" className="btn btn--danger" onClick={handleDelete}>Delete</button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          {(initial ? can('purchases', 'edit') : can('purchases', 'add')) && (
            <button type="button" className="btn btn--primary" onClick={handleSave}>Save</button>
          )}
        </>
      }
    >
      <div className="po-form">
        <FormGrid>
          <FormField label="Lot #">
            <input
              className="input mono"
              placeholder="Select a grower…"
              value={lotNumber}
              onChange={(e) => {
                setLotNumber(e.target.value);
                setLotAuto(false);
              }}
            />
          </FormField>
          <FormField label="# Ref">
            <input className="input" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} />
          </FormField>
          <FormField label="Arrival date">
            <input className="input" type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
          </FormField>
          <FormField label="Grower / Origin">
            <CatalogSelect
              value={growerId}
              onChange={setGrowerId}
              options={growers.options}
              collection={COLLECTIONS.GROWER}
              nameField="NAME_GROWER"
              catalogLabel="grower"
            />
          </FormField>
          <FormField label="Vendor">
            <CatalogSelect
              value={customerId}
              onChange={setCustomerId}
              options={customers.options}
              collection={COLLECTIONS.CUSTOMER}
              nameField="NAME_CUSTOMER"
              catalogLabel="vendor"
            />
          </FormField>
          <FormField label="Buyer">
            <SearchableSelect value={userId} onChange={setUserId} options={users.options} placeholder="Select buyer…" />
          </FormField>
          <FormField label="Carrier">
            <CatalogSelect
              value={carrierId}
              onChange={setCarrierId}
              options={carriers.options}
              collection={COLLECTIONS.CARRIER}
              nameField="NAME_CARRIER"
              catalogLabel="carrier"
            />
          </FormField>
          <FormField label="Ship to">
            <CatalogSelect
              value={shipTo}
              onChange={setShipTo}
              options={locations.options}
              collection={COLLECTIONS.LOCATIONS}
              nameField="NAME_LOCATIONS"
              catalogLabel="location"
            />
          </FormField>
          <FormField label="Commission %">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={commissionPercent}
              onChange={(e) => setCommissionPercent(e.target.value)}
            />
          </FormField>
          <FormField label="Note" span2>
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </FormGrid>

        <LineItemsEditor lines={lines} onChange={setLines} commodities={commodities.options} />

        <div className="po-form__summary">
          <span>Quantity <b className="num">{quantity}</b></span>
          <span>Merchandise subtotal <b className="num">{fmtMoney(subtotal)}</b></span>
          <span>Commission <b className="num">{fmtMoney(commissionAmount)}</b></span>
          <span className="po-form__summary-total">Order total <b className="num">{fmtMoney(total)}</b></span>
        </div>
      </div>
    </Modal>
  );
}
