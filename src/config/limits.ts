/**
 * Limites de lectura y paginacion de la app.
 * Objetivo: no traer colecciones completas de Firestore ni pintar miles de filas.
 */

/** Filas visibles por pagina en todas las tablas. */
export const PAGE_SIZE = 50;

/**
 * Tope de documentos que cada vista de lista suscribe en Firestore.
 * Limita las lecturas facturables sin romper la navegacion normal.
 */
export const READ_LIMIT = 500;
