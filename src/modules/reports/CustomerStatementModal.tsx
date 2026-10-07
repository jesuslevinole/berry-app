import { useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import type { CatalogOption } from '../../hooks/useCatalog';
import {
  buildCustomerStatementHtml,
  printCustomerStatement,
  type StatementInput,
  type StatementRow,
} from '../../services/customerStatementService';
import { SendEmailModal } from '../../components/ui/SendEmailModal';
import { htmlToPdfBase64 } from '../../services/htmlToPdf';
import type { CompanyInfo, SalesOrder } from '../../types/models';
import { fmtMoney, round2, todayISO } from '../../utils/format';
import './CustomerStatementModal.css';

export interface PendingSale {
  so: SalesOrder;
  balance: number;
  days: number | null;
}

interface Props {
  company: CompanyInfo;
  /** Solo cuentas pendientes (saldo > 0, no canceladas), sin el filtro de busqueda. */
  pending: PendingSale[];
  /** Cliente preseleccionado (el elegido en el panel de AR). */
  defaultCustomerId: string;
  customerName: (id?: string) => string;
  onClose: () => void;
}

/** Filtro del estado de cuenta (como el "Filter Excel" de AppSheet): fechas, cliente y Aging Total. */
export function CustomerStatementModal({ company, pending, defaultCustomerId, customerName, onClose }: Props) {
  /* Clientes con saldo pendiente. */
  const customerOptions = useMemo<CatalogOption[]>(() => {
    const ids = [...new Set(pending.map((p) => p.so.ID_CUSTOMER || ''))].filter(Boolean);
    return ids.map((id) => ({ id, name: customerName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [pending, customerName]);

  const earliestFor = (customerId: string): string =>
    pending
      .filter((p) => !customerId || p.so.ID_CUSTOMER === customerId)
      .map((p) => p.so.DATE ?? '')
      .filter(Boolean)
      .sort()[0] ?? '';

  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [startDate, setStartDate] = useState(() => earliestFor(defaultCustomerId));
  const [endDate, setEndDate] = useState(todayISO());
  const [emailOpen, setEmailOpen] = useState(false);


  const rows = useMemo(
    () =>
      pending
        .filter((p) => p.so.ID_CUSTOMER === customerId)
        .filter((p) => (!startDate || (p.so.DATE ?? '') >= startDate) && (!endDate || (p.so.DATE ?? '') <= endDate))
        .sort(
          (a, b) =>
            (a.so.DATE ?? '').localeCompare(b.so.DATE ?? '') ||
            (a.so.SALES_ORDER_NUMBER ?? '').localeCompare(b.so.SALES_ORDER_NUMBER ?? ''),
        ),
    [pending, customerId, startDate, endDate],
  );
  const agingTotal = round2(rows.reduce((acc, r) => acc + r.balance, 0));

  const changeCustomer = (id: string) => {
    setCustomerId(id);
    setStartDate(earliestFor(id));
  };

  /** Datos del documento con el filtro actual (para imprimir o enviar). */
  const statementInput = (): StatementInput => {
    const name = customerName(customerId);
    const statementRows: StatementRow[] = rows.map((r) => ({
      salesOrder: r.so.SALES_ORDER_NUMBER ?? '',
      date: r.so.DATE ?? '',
      customer: name,
      ref: r.so.REF ?? '',
      total: round2(r.so.TOTAL ?? 0),
      balance: r.balance,
      dueDate: r.so.DUE_DATE ?? '',
      overdueDays: r.days,
    }));
    return { company, customerName: name, startDate, endDate, rows: statementRows };
  };

  const download = () => {
    if (!customerId) {
      alert('Select the customer.');
      return;
    }
    printCustomerStatement(statementInput());
  };

  const fileName = `Statement-${customerName(customerId)
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}.pdf`;

  return (
    <>
      <Modal
        title="Customer statement"
        open
        onClose={onClose}
        confirmOnClose={false}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={!customerId || rows.length === 0}
              onClick={() => setEmailOpen(true)}
            >
              Email statement
            </button>
            <button type="button" className="btn btn--primary" disabled={!customerId} onClick={download}>
              Download PDF
            </button>
          </>
        }
      >
        <FormGrid>
          <FormField label="Start date">
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="End date">
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </FormField>
          <FormField label="Customer" required span2>
            <SearchableSelect value={customerId} onChange={changeCustomer} options={customerOptions} placeholder="Customer…" />
          </FormField>
        </FormGrid>

        <div className="statement-filter__summary">
          <span className="statement-filter__label">Aging total</span>
          <b className="num statement-filter__total">{customerId ? fmtMoney(agingTotal) : '—'}</b>
          <span className="statement-filter__count">
            {customerId ? `${rows.length} pending ${rows.length === 1 ? 'invoice' : 'invoices'}` : 'Select a customer'}
          </span>
        </div>
      </Modal>
      {emailOpen && customerId && (
        <SendEmailModal
          title={`Email statement — ${customerName(customerId)}`}
          docType="statement"
          defaultSubject={`Account statement — ${company.name || ''}`}
          defaultMessage={`Hello ${customerName(customerId)},\n\nPlease find attached your account statement with ${rows.length} pending ${rows.length === 1 ? 'invoice' : 'invoices'} for a total of ${fmtMoney(agingTotal)}.\n\nIf you have already sent payment, please disregard this message.\n\nThank you,\n${company.name || ''}`}
          attachmentName={fileName}
          buildAttachment={async () => ({
            filename: fileName,
            content: await htmlToPdfBase64(buildCustomerStatementHtml(statementInput()), { orientation: 'landscape' }),
          })}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </>
  );
}
