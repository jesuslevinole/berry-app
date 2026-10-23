import { useMemo } from 'react';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { useCollection } from '../../hooks/useCollection';
import { COLLECTIONS, type BaseDoc } from '../../types/models';

interface PayeeAddressDoc extends BaseDoc {
  ADDRESS_CUSTOMER?: string;
  CITY_CUSTOMER?: string;
  ADDRESS_SUPPLIERS?: string;
}

/**
 * Beneficiarios de un cheque: Customers, Suppliers y Growers en una sola lista.
 * El cheque sigue guardando el ID en ID_CUSTOMER (cheques viejos = clientes); el nombre
 * se busca en los tres catalogos, en ese orden.
 */
export function useCheckPayees() {
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const { data: customerDocs } = useCollection<PayeeAddressDoc>(COLLECTIONS.CUSTOMER);
  const { data: supplierDocs } = useCollection<PayeeAddressDoc>(COLLECTIONS.SUPPLIERS);

  /* En la lista se ve el tipo, porque un mismo nombre puede estar en dos catalogos. */
  const options = useMemo<CatalogOption[]>(
    () =>
      [
        ...customers.options.map((o) => ({ id: o.id, name: `${o.name} (Customer)` })),
        ...suppliers.options.map((o) => ({ id: o.id, name: `${o.name} (Supplier)` })),
        ...growers.options.map((o) => ({ id: o.id, name: `${o.name} (Grower)` })),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [customers.options, suppliers.options, growers.options],
  );

  /** Nombre del beneficiario (sin el tipo), para la tabla, la busqueda y el cheque impreso. */
  const nameOf = useMemo(
    () =>
      (id?: string): string => {
        for (const catalog of [customers, suppliers, growers]) {
          const name = catalog.nameOf(id);
          if (name !== '—') return name;
        }
        return '—';
      },
    [customers, suppliers, growers],
  );

  /** ID del documento del beneficiario (resuelve IDs viejos de AppSheet); '' si no existe. */
  const canonicalId = useMemo(
    () =>
      (id?: string): string => {
        for (const catalog of [customers, suppliers, growers]) {
          if (catalog.nameOf(id) !== '—') return catalog.canonicalId(id);
        }
        return id ?? '';
      },
    [customers, suppliers, growers],
  );

  /** Direccion para la ventana del sobre: calle y ciudad del cliente, o la del supplier. Los growers no tienen. */
  const addressOf = useMemo(
    () =>
      (id?: string): string => {
        const docId = canonicalId(id);
        const customer = customerDocs.find((c) => c.id === docId);
        if (customer) return [customer.ADDRESS_CUSTOMER ?? '', customer.CITY_CUSTOMER ?? ''].filter((l) => l.trim()).join('\n');
        return (supplierDocs.find((s) => s.id === docId)?.ADDRESS_SUPPLIERS ?? '').trim();
      },
    [canonicalId, customerDocs, supplierDocs],
  );

  return { options, nameOf, canonicalId, addressOf };
}
