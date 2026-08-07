/**
 * Generacion del Lot # de Purchase Orders:
 *   PREFIX del grower + consecutivo de 5 digitos (00001, 00002, ...).
 *
 * Enfoque dual-query (mismo patron que Roelca):
 *  1) Al seleccionar grower, se consulta el maximo existente para SUGERIR el numero.
 *  2) Justo antes de crear, se vuelve a consultar el maximo para CONFIRMAR el
 *     numero final, evitando duplicados o saltos si alguien mas creo una PO
 *     entre la sugerencia y el guardado.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS } from '../types/models';

const PAD_LENGTH = 5;

/** Construye el Lot # con el consecutivo dado: ALP + 1 -> ALP00001. */
export const formatLot = (prefix: string, consecutive: number): string =>
  `${prefix}${String(consecutive).padStart(PAD_LENGTH, '0')}`;

/** true si el lot sigue el patron prefix + digitos (numero autogenerado). */
export const isAutoLot = (lot: string, prefix: string): boolean =>
  !!prefix && new RegExp(`^${escapeRegExp(prefix)}\\d+$`).test(lot);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Consulta las POs existentes del grower y devuelve el siguiente consecutivo
 * disponible para su prefijo. Sin registros previos devuelve 1 (-> 00001).
 */
export async function nextLotForGrower(growerId: string, prefix: string): Promise<string> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.PURCHASE_ORDER), where('ID_GROWER', '==', growerId)),
  );
  let max = 0;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  snap.forEach((docSnap) => {
    const lot = String(docSnap.get('LOT_NUMBER') ?? '');
    const match = pattern.exec(lot);
    if (match) {
      const value = parseInt(match[1], 10);
      if (Number.isFinite(value) && value > max) max = value;
    }
  });
  return formatLot(prefix, max + 1);
}
