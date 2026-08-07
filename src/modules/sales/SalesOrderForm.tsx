import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { where } from 'firebase/firestore';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { createDocument, deleteDocument, listDocuments, replaceChildren, updateDocument } from '../../services/firestore';
import { COLLECTIONS, SALES_STATUSES, type SalesOrder, type SalesOrderDetail, type SalesStatus } from '../../types/models';
import { fmtMoney, round2, todayISO, toNumber } from '../../utils/format';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { LineItemsEditor, lineTotal, sumLineTotals, type LineDraft } from '../../components/ui/LineItemsEditor';
import './SalesOrderForm.css';

interface SalesOrderFormProps {
  open: boolean;
  initial: SalesOrder | null;
  purchaseOrderOptions: CatalogOption[];
  onClose: () => void;
}

export function SalesOrderForm({ open, initial, purchaseOrderOptions, onClose }: SalesOrderFormProps) {
  const { can } = useAuth();
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const buyerOptions = useMemo(
    () =>
      [...systemUsers]
        .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [systemUsers],
  );
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const shipVia = useCatalog(COLLECTIONS.SHIPVIA, 'NAME_SHIPVIA');
  const termShipping = useCatalog(COLLECTIONS.TERMSHIPPING, 'NAME_TERMSHIPPING');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');

  const [salesOrderNumber, setSalesOrderNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<SalesStatus>('Draft');
  const [sent, setSent] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [userId, setUserId] = useState('');
  const [buyer, setBuyer] = useState('');
  const [ref, setRef] = useState('');
  const [refPickup, setRefPickup] = useState('');
  const [pickUpNumber, setPickUpNumber] = useState('');
  const [address, setAddress] = useState('');
  const [cityStateZip, setCityStateZip] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [shipViaId, setShipViaId] = useState('');
  const [termShippingId, setTermShippingId] = useState('');
  const [tempLog, setTempLog] = useState('');
  const [description, setDescription] = useState('');
  const [odDay, setOdDay] = useState('0');
  const [lines, setLines] = useState<LineDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setSalesOrderNumber(initial?.SALES_ORDER_NUMBER ?? '');
    setDate(initial?.DATE ?? todayISO());
    setDueDate(initial?.DUE_DATE ?? '');
    setStatus(initial?.STATUS ?? 'Draft');
    setSent(initial?.SENT ?? false);
    setCustomerId(initial?.ID_CUSTOMER ?? '');
    setUserId(initial?.ID_USERS ?? '');
    setBuyer(initial?.BUYER ?? '');
    setRef(initial?.REF ?? '');
    setRefPickup(initial?.REF_PICKUP ?? '');
    setPickUpNumber(initial?.PICK_UP_NUMBER ?? '');
    setAddress(initial?.ADDRESS ?? '');
    setCityStateZip(initial?.CITY_STATE_ZIP ?? '');
    setSupplierId(initial?.ID_SUPPLIERS ?? '');
    setCarrierId(initial?.ID_CARRIER ?? '');
    setShipViaId(initial?.ID_SHIPVIA ?? '');
    setTermShippingId(initial?.ID_TERMSHIPPING ?? '');
    setTempLog(initial?.TEMP_LOG ?? '');
    setDescription(initial?.DESCRIPTION ?? '');
    setOdDay(String(initial?.OD_DAY ?? 0));
    setLines([]);
    if (initial) {
      void listDocuments<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL, [
        where('ID_SALESORDER', '==', initial.id),
      ]).then((details) =>
        setLines(
          details.map((d) => ({
            id: d.id,
            ID_COMMODITIES: d.ID_COMMODITIES,
            ID_PURCHASEORDER: d.ID_PURCHASEORDER,
            DESCRIPTION: d.DESCRIPTION,
            QUANTITY: d.QUANTITY,
            PRICE: d.PRICE,
          })),
        ),
      );
    }
  }, [open, initial]);

  const total = useMemo(() => sumLineTotals(lines), [lines]);

  /** Cierre inmediato: encabezado + detalle se guardan en segundo plano (local-first). */
  const handleSave = () => {
    const incomes = initial?.INCOMES ?? 0;
      const payload: Omit<SalesOrder, 'id'> = {
        ID_CUSTOMER: customerId,
        BUYER: buyer.trim(),
        ID_USERS: userId,
        REF: ref.trim(),
        REF_PICKUP: refPickup.trim(),
        DATE: date,
        DUE_DATE: dueDate,
        STATUS: status,
        SALES_ORDER_NUMBER: salesOrderNumber.trim(),
        PICK_UP_NUMBER: pickUpNumber.trim(),
        ADDRESS: address.trim(),
        CITY_STATE_ZIP: cityStateZip.trim(),
        ID_SUPPLIERS: supplierId,
        TEMP_LOG: tempLog.trim(),
        DESCRIPTION: description.trim(),
        ID_CARRIER: carrierId,
        ID_TERMSHIPPING: termShippingId,
        ID_SHIPVIA: shipViaId,
        TOTAL: total,
        INCOMES: incomes,
        BALANCE: round2(total - incomes),
        OD_DAY: toNumber(odDay),
        SENT: sent,
      };
      const detailRows = lines.map((line) => ({
        id: line.id,
        ID_PURCHASEORDER: line.ID_PURCHASEORDER ?? '',
        ID_COMMODITIES: line.ID_COMMODITIES,
        DESCRIPTION: line.DESCRIPTION ?? '',
        QUANTITY: line.QUANTITY,
        PRICE: line.PRICE,
        TOTAL: lineTotal(line),
      }));
      const editingId = initial?.id ?? null;
      onClose();

      const persist = async () => {
        const orderId = editingId
          ? (await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, editingId, payload), editingId)
          : await createDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, payload);
        await replaceChildren(COLLECTIONS.SALES_ORDER_DETAIL, 'ID_SALESORDER', orderId, detailRows);
      };
      persist().catch((error: unknown) =>
        alert(`Failed to save sales order: ${(error as Error).message ?? 'Unknown error'}`),
      );
  };

  const handleDelete = () => {
    if (!initial) return;
    if (!window.confirm(`Delete sales order ${initial.SALES_ORDER_NUMBER}?`)) return;
    const orderId = initial.id;
    onClose();
    const persist = async () => {
      await replaceChildren(COLLECTIONS.SALES_ORDER_DETAIL, 'ID_SALESORDER', orderId, []);
      await deleteDocument(COLLECTIONS.SALES_ORDER, orderId);
    };
    persist().catch((error: unknown) =>
      alert(`Failed to delete sales order: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <Modal
      title={initial ? `Edit sales order ${initial.SALES_ORDER_NUMBER}` : 'New sales order'}
      open={open}
      onClose={onClose}
      wide
      footer={
        <>
          {initial && can('sales', 'delete') && (
            <button type="button" className="btn btn--danger" onClick={handleDelete}>Delete</button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          {(initial ? can('sales', 'edit') : can('sales', 'add')) && (
            <button type="button" className="btn btn--primary" onClick={handleSave}>Save</button>
          )}
        </>
      }
    >
      <div className="so-form">
        <h4 className="so-form__section">General information</h4>
        <FormGrid>
          <FormField label="# Sales order">
            <input className="input mono" placeholder="46102" value={salesOrderNumber} onChange={(e) => setSalesOrderNumber(e.target.value)} />
          </FormField>
          <FormField label="Status">
            <SearchableSelect
              value={status}
              onChange={(id) => setStatus((id || 'Draft') as SalesStatus)}
              options={SALES_STATUSES.map((s) => ({ id: s, name: s }))}
              placeholder="Status…"
            />
          </FormField>
          <FormField label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Due date">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
          <FormField label="Customer">
            <CatalogSelect
              value={customerId}
              onChange={setCustomerId}
              options={customers.options}
              collection={COLLECTIONS.CUSTOMER}
              nameField="NAME_CUSTOMER"
              catalogLabel="customer"
            />
          </FormField>
          <FormField label="Buyer">
            <input className="input" placeholder="W. Bentley" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          </FormField>
          <FormField label="Salesperson">
            <SearchableSelect value={userId} onChange={setUserId} options={buyerOptions} placeholder="Select buyer…" />
          </FormField>
          <FormField label="Supplier">
            <CatalogSelect
              value={supplierId}
              onChange={setSupplierId}
              options={suppliers.options}
              collection={COLLECTIONS.SUPPLIERS}
              nameField="NAME_SUPPLIERS"
              catalogLabel="supplier"
            />
          </FormField>
          <FormField label="Ref">
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
          </FormField>
          <FormField label="Ref pickup">
            <input className="input" value={refPickup} onChange={(e) => setRefPickup(e.target.value)} />
          </FormField>
          <FormField label="Pick up #">
            <input className="input" value={pickUpNumber} onChange={(e) => setPickUpNumber(e.target.value)} />
          </FormField>
          <FormField label="OD day">
            <input className="input" type="number" min="0" step="1" value={odDay} onChange={(e) => setOdDay(e.target.value)} />
          </FormField>
        </FormGrid>

        <h4 className="so-form__section">Shipping</h4>
        <FormGrid>
          <FormField label="Address" span2>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </FormField>
          <FormField label="City / State / ZIP">
            <input className="input" value={cityStateZip} onChange={(e) => setCityStateZip(e.target.value)} />
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
          <FormField label="Ship via">
            <CatalogSelect
              value={shipViaId}
              onChange={setShipViaId}
              options={shipVia.options}
              collection={COLLECTIONS.SHIPVIA}
              nameField="NAME_SHIPVIA"
              catalogLabel="ship via"
            />
          </FormField>
          <FormField label="Shipping terms">
            <CatalogSelect
              value={termShippingId}
              onChange={setTermShippingId}
              options={termShipping.options}
              collection={COLLECTIONS.TERMSHIPPING}
              nameField="NAME_TERMSHIPPING"
              catalogLabel="shipping term"
            />
          </FormField>
          <FormField label="Temp log">
            <input className="input" value={tempLog} onChange={(e) => setTempLog(e.target.value)} />
          </FormField>
          <FormField label="Description">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Sent">
            <span className="checkbox-row">
              <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} />
              Order sent to customer
            </span>
          </FormField>
        </FormGrid>

        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          commodities={commodities.options}
          purchaseOrders={purchaseOrderOptions}
          showDescription
        />

        <div className="so-form__summary">
          <span>Order total <b className="num">{fmtMoney(total)}</b></span>
        </div>
      </div>
    </Modal>
  );
}
