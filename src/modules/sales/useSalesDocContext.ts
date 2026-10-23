import { useMemo } from 'react';
import { useCatalog } from '../../hooks/useCatalog';
import { useCollection } from '../../hooks/useCollection';
import { useCompany } from '../../hooks/useCompany';
import { useInventoryItems } from '../../hooks/useInventoryItems';
import type { SalesDocContext } from '../../services/salesDocumentsService';
import { COLLECTIONS, type BaseDoc, type PurchaseOrder, type SalesOrder } from '../../types/models';

interface CustomerDoc extends BaseDoc {
  ADDRESS_CUSTOMER?: string;
  CITY_CUSTOMER?: string;
}

interface SupplierDoc extends BaseDoc {
  ADDRESS_SUPPLIERS?: string;
  PHONE_SUPPLIERS?: string;
}

interface LocationDoc extends BaseDoc {
  ADDRESS_LOCATIONS?: string;
  PHONE_LOCATIONS?: string;
}

/**
 * Datos que necesitan los documentos imprimibles de una orden de venta (Invoice, Pick Ticket,
 * Sales Order, Passing, BOL). Las colecciones se comparten con las demas pantallas (useCollection).
 * `buyerName` lo da la vista, que ya resuelve usuarios del sistema y el catalogo legado.
 */
export function useSalesDocContext(buyerName: (id?: string) => string) {
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const shipVia = useCatalog(COLLECTIONS.SHIPVIA, 'NAME_SHIPVIA');
  const termShipping = useCatalog(COLLECTIONS.TERMSHIPPING, 'NAME_TERMSHIPPING');
  const paymentTermsCat = useCatalog(COLLECTIONS.PAYMENTTERM, 'NAME_PAYMENTTERM');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { descriptionOf } = useInventoryItems();
  const { data: customerDocs } = useCollection<CustomerDoc>(COLLECTIONS.CUSTOMER);
  const { data: supplierDocs } = useCollection<SupplierDoc>(COLLECTIONS.SUPPLIERS);
  const { data: locationDocs } = useCollection<LocationDoc>(COLLECTIONS.LOCATIONS);
  const { company } = useCompany();

  const lotMap = useMemo(() => new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? ''])), [purchaseOrders]);

  /** Contexto compartido de los documentos imprimibles de la orden. */
  const docContextOf = (so: SalesOrder): SalesDocContext => {
    const customerDoc = customerDocs.find((c) => c.id === so.ID_CUSTOMER);
    const supplierDoc = supplierDocs.find((s) => s.id === so.ID_SUPPLIERS);
    /* Almacen de la orden; las ordenes viejas caen al supplier legado. */
    const warehouseDoc = locationDocs.find((l) => l.id === so.ID_WAREHOUSE);
    const warehouseName = so.ID_WAREHOUSE ? locations.nameOf(so.ID_WAREHOUSE) : suppliers.nameOf(so.ID_SUPPLIERS);
    return {
      company,
      customerName: customers.nameOf(so.ID_CUSTOMER),
      customerAddress: customerDoc?.ADDRESS_CUSTOMER ?? '',
      customerCity: customerDoc?.CITY_CUSTOMER ?? '',
      salesPerson: buyerName(so.ID_USERS),
      carrierName: carriers.nameOf(so.ID_CARRIER),
      shipViaName: shipVia.nameOf(so.ID_SHIPVIA),
      shippingTermsName: termShipping.nameOf(so.ID_TERMSHIPPING),
      paymentTermName: so.ID_PAYMENTTERM ? paymentTermsCat.nameOf(so.ID_PAYMENTTERM) : '',
      warehouseName: warehouseName === '—' ? '' : warehouseName,
      warehouseAddress: warehouseDoc?.ADDRESS_LOCATIONS ?? supplierDoc?.ADDRESS_SUPPLIERS ?? '',
      warehousePhone: warehouseDoc?.PHONE_LOCATIONS ?? supplierDoc?.PHONE_SUPPLIERS ?? '',
      lotOf: (id) => lotMap.get(id) ?? '',
      commodityName: (id) => commodities.nameOf(id),
      commodityDescription: descriptionOf,
    };
  };

  return { docContextOf, company, customerName: customers.nameOf };
}
