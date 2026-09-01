import { InventoryView } from './InventoryView';
import { SalesDeskView } from '../sales/SalesDeskView';
import './InventoryAndSalesView.css';

/**
 * Vista combinada "Inventory and Sales":
 * - Inventario fijo arriba (no se mueve al scrollear; si crece mucho, scrollea internamente).
 * - Sales Desk abajo con su propio scroll independiente.
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
