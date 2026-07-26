import { useEffect, useState } from 'react';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { COLLECTIONS, type Expense } from '../../types/models';
import { round2, todayISO, toNumber } from '../../utils/format';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import './ExpenseForm.css';

interface ExpenseFormProps {
  open: boolean;
  initial: Expense | null;
  purchaseOrderOptions: CatalogOption[];
  onClose: () => void;
}

export function ExpenseForm({ open, initial, purchaseOrderOptions, onClose }: ExpenseFormProps) {
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');

  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [deduct, setDeduct] = useState(false);
  const [checkNumber, setCheckNumber] = useState('');
  const [photoCheck, setPhotoCheck] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPurchaseOrderId(initial?.ID_PURCHASEORDER ?? '');
    setSupplierId(initial?.ID_SUPPLIERS ?? '');
    setCategoryId(initial?.ID_CATEGORYBILL ?? '');
    setInvoiceNumber(initial?.INVOICE_NUMBER ?? '');
    setDate(initial?.DATE ?? todayISO());
    setAmount(initial ? String(initial.AMOUNT ?? 0) : '');
    setDeduct(initial?.DEDUCT ?? false);
    setCheckNumber(initial?.CHECK_NUMBER ?? '');
    setPhotoCheck(initial?.PHOTO_CHECK ?? '');
    setNote(initial?.NOTE ?? '');
  }, [open, initial]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const amountValue = round2(toNumber(amount));
      const payAmount = initial?.PAY_AMOUNT ?? 0;
      const payload: Omit<Expense, 'id'> = {
        ID_PURCHASEORDER: purchaseOrderId,
        DEDUCT: deduct,
        ID_SUPPLIERS: supplierId,
        ID_CATEGORYBILL: categoryId,
        INVOICE_NUMBER: invoiceNumber.trim(),
        DATE: date,
        AMOUNT: amountValue,
        PAY_AMOUNT: payAmount,
        BALANCE: round2(amountValue - payAmount),
        PHOTO_CHECK: photoCheck.trim(),
        CHECK_NUMBER: checkNumber.trim(),
        NOTE: note.trim(),
      };
      if (initial) {
        await updateDocument<Expense>(COLLECTIONS.EXPENSES, initial.id, payload);
      } else {
        await createDocument<Expense>(COLLECTIONS.EXPENSES, payload);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    if (!window.confirm(`Delete expense ${initial.INVOICE_NUMBER || ''}?`)) return;
    await deleteDocument(COLLECTIONS.EXPENSES, initial.id);
    onClose();
  };

  return (
    <Modal
      title={initial ? 'Edit expense' : 'New expense'}
      open={open}
      onClose={onClose}
      footer={
        <>
          {initial && (
            <button type="button" className="btn btn--danger" onClick={() => void handleDelete()}>Delete</button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || toNumber(amount) <= 0}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="expense-form">
        <FormGrid>
          <FormField label="# Lot (purchase order)">
            <select className="input" value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
              <option value="">Select…</option>
              {purchaseOrderOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FormField>
          <FormField label="Supplier">
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select…</option>
              {suppliers.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FormField>
          <FormField label="Category">
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Select…</option>
              {categories.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FormField>
          <FormField label="Invoice #">
            <input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </FormField>
          <FormField label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Amount">
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField label="Check #">
            <input className="input" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </FormField>
          <FormField label="Photo check (URL)">
            <input className="input" value={photoCheck} onChange={(e) => setPhotoCheck(e.target.value)} />
          </FormField>
          <FormField label="Deduct">
            <span className="checkbox-row">
              <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
              Deduct from purchase order
            </span>
          </FormField>
          <FormField label="Note" span2>
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </FormGrid>
      </div>
    </Modal>
  );
}
