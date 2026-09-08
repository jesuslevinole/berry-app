import { InventoryView } from './InventoryView';

/**
 * Compatibilidad: la vista combinada ahora vive dentro de InventoryView
 * (inventario sticky + Sales Desk debajo). Este wrapper evita duplicados
 * si App.tsx renderiza este componente.
 */
export function InventoryAndSalesView() {
  return <InventoryView />;
}
