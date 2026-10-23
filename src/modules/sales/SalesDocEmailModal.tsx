import { SendEmailModal } from '../../components/ui/SendEmailModal';
import { bundleKey, isBundleKey } from '../../config/emailDocs';
import { useEmailBundles } from '../../hooks/useEmailBundles';
import { usDate } from '../../services/emailTemplates';
import { htmlToPdfBase64 } from '../../services/htmlToPdf';
import type { EmailKey, SalesOrder } from '../../types/models';
import { fmtMoney } from '../../utils/format';
import { SALES_DOCS } from './salesDocs';
import { useSalesDocContext } from './useSalesDocContext';

interface SalesDocEmailModalProps {
  order: SalesOrder;
  /** Un documento ('invoice', 'pick'…) o un envio combinado de Email Settings (bundle_<id>). */
  emailKey: EmailKey;
  buyerName: (id?: string) => string;
  onClose: () => void;
  /** Se llama cuando el correo salio (ej. Invoice Queue marca la orden como Sent). */
  onSent?: () => void;
}

/** Correo de uno o varios documentos de una orden de venta, con los PDF adjuntos. */
export const SalesDocEmailModal = ({ order, emailKey, buyerName, onClose, onSent }: SalesDocEmailModalProps) => {
  const { bundles } = useEmailBundles();
  const { docContextOf, company, customerName } = useSalesDocContext(buyerName);

  const bundle = isBundleKey(emailKey) ? bundles.find((b) => bundleKey(b.id) === emailKey) : undefined;
  /* Documentos que van en el correo: uno solo o los del combinado. */
  const docDefs = bundle ? SALES_DOCS.filter((d) => bundle.DOCS.includes(d.id)) : SALES_DOCS.filter((d) => d.id === emailKey);
  if (docDefs.length === 0) return null;

  const label = bundle ? bundle.NAME : docDefs[0].label;
  const number = order.SALES_ORDER_NUMBER || 'order';

  return (
    <SendEmailModal
      emailKey={emailKey}
      label={label}
      docRef={number}
      customerId={order.ID_CUSTOMER}
      warehouseId={order.ID_WAREHOUSE || undefined}
      title={`Email ${label} — ${number}`}
      values={{
        number,
        customer: customerName(order.ID_CUSTOMER),
        ref: order.REF ?? '',
        total: fmtMoney(order.TOTAL ?? 0),
        date: usDate(order.DATE),
        due_date: usDate(order.DUE_DATE),
        company: company.name || '',
        documents: docDefs.map((d) => d.label).join(' & '),
      }}
      attachments={docDefs.map((d) => {
        const fileName = `${d.file}-${number}.pdf`;
        return {
          name: fileName,
          build: async () => ({ filename: fileName, content: await htmlToPdfBase64(await d.build(order, docContextOf(order))) }),
        };
      })}
      onClose={onClose}
      onSent={onSent}
    />
  );
};
