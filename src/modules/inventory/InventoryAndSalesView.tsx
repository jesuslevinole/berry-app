import { InventoryView } from './InventoryView';
import { SalesDeskView } from '../sales/SalesDeskView';
import './InventoryAndSalesView.css';

/**
 * Vista combinada "Inventory and Sales":
 * - Inventario sticky arriba (queda pegado bajo el topbar al scrollear).
 * - Sales Desk SIEMPRE renderizado debajo, scrolleando con la pagina.
 */
export function InventoryAndSalesView() {
  return (
    <div className="invsales">
      <section className="invsales__fixed">
        <InventoryView />
      </section>
      <section className="invsales__scroll">
        <SalesDeskView />
      </section>
    </div>
  );
}
