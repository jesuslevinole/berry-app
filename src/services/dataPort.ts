/**
 * Exportacion a Excel (template + datos) e importacion desde CSV.
 * ExcelJS se carga con import dinamico para que no entre en el bundle inicial.
 */
import type { Workbook } from 'exceljs';
import type { EntityField, EntitySchema } from '../config/entitySchemas';
import type { BaseDoc } from '../types/models';
import { bulkUpsert, listDocuments, updateDocument, where } from './firestore';
import { round2 } from '../utils/format';
import { COLLECTIONS, type PurchaseDetail, type PurchaseOrder, type SalesOrder, type SalesOrderDetail } from '../types/models';
import {
  normalizeHeader,
  parseBooleanValue,
  parseCsv,
  parseDateValue,
  parseNumberValue,
} from '../utils/csv';

const HEADER_COLOR = 'FF265C46'; // --green-600, misma marca del app
const ID_COLOR = 'FF11291F'; // --green-900 para destacar la columna del ID

export interface ImportResult {
  collection: string;
  totalRows: number;
  imported: number;
  withAppsheetId: number;
  generatedId: number;
  errors: string[];
}

type AnyDoc = BaseDoc & Record<string, unknown>;

const excelValue = (row: AnyDoc, field: EntityField): string | number | boolean => {
  const raw = row[field.key];
  if (raw === undefined || raw === null) return field.type === 'number' ? 0 : field.type === 'boolean' ? false : '';
  if (field.type === 'number') return Number(raw) || 0;
  if (field.type === 'boolean') return Boolean(raw);
  return String(raw);
};

/**
 * Descarga un Excel con una hoja por esquema: encabezados en el orden correcto
 * y los registros que hoy existen en Firestore. Sirve como template de carga.
 */
export async function downloadTemplate(schemas: EntitySchema[], fileName: string): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook: Workbook = new ExcelJS.Workbook();
  workbook.creator = 'Berry Source LLC';
  workbook.created = new Date();

  for (const schema of schemas) {
    const rows = await listDocuments<AnyDoc>(schema.collection);
    const sheet = workbook.addWorksheet(schema.label.slice(0, 31));

    sheet.columns = [
      { header: schema.idField, key: schema.idField, width: 26 },
      ...schema.fields.map((field) => ({
        header: field.key,
        key: field.key,
        width: field.width ?? 18,
      })),
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;
    header.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ID_COLOR } };

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: schema.fields.length + 1 },
    };

    for (const field of schema.fields) {
      if (field.type === 'number') sheet.getColumn(field.key).numFmt = '#,##0.00';
    }

    for (const row of rows) {
      const values: Record<string, string | number | boolean> = { [schema.idField]: row.id };
      for (const field of schema.fields) values[field.key] = excelValue(row, field);
      sheet.addRow(values);
    }
  }

  addInstructionsSheet(workbook, schemas);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function addInstructionsSheet(workbook: Workbook, schemas: EntitySchema[]): void {
  const sheet = workbook.addWorksheet('How to import');
  sheet.columns = [{ width: 110 }];

  const title = sheet.addRow(['Import instructions']);
  title.font = { bold: true, size: 13, color: { argb: HEADER_COLOR } };

  const lines = [
    '',
    '1. Fill one sheet per collection. Do not rename or reorder the header row.',
    '2. The first column is the primary key. Keep the ID that comes from AppSheet:',
    '   the app writes each record using that exact value as its Firestore document ID,',
    '   so every relationship (ID_GROWER, ID_CUSTOMER, ID_PURCHASEORDER, …) keeps working.',
    '3. Leave the ID cell empty only for brand new records: the app will generate one.',
    '4. Importing an ID that already exists updates that record (it never duplicates it).',
    '5. Import the parent sheets first (orders, catalogs) and the child sheets after',
    '   (details, payments), so the referenced IDs already exist.',
    '6. Dates: yyyy-mm-dd or m/d/yyyy. Booleans: TRUE / FALSE (also Yes / No, 1 / 0).',
    '7. Amounts: plain numbers, with or without $ and thousand separators.',
    '8. Save each sheet as CSV and upload it with the "Import CSV" button of the module.',
    '',
    'Sheets included in this file:',
    ...schemas.map((schema) => `   • ${schema.label} → ${schema.collection} (PK: ${schema.idField})`),
  ];

  for (const line of lines) sheet.addRow([line]);
}

/**
 * Importa un CSV a una coleccion respetando el ID de AppSheet como ID de documento.
 * Las filas con ID existente se actualizan (merge), nunca se duplican.
 */
export async function importCsvFile(schema: EntitySchema, file: File): Promise<ImportResult> {
  const text = await file.text();
  const matrix = parseCsv(text);

  const result: ImportResult = {
    collection: schema.collection,
    totalRows: 0,
    imported: 0,
    withAppsheetId: 0,
    generatedId: 0,
    errors: [],
  };

  if (matrix.length < 2) {
    result.errors.push('The file has no data rows.');
    return result;
  }

  const headers = matrix[0].map(normalizeHeader);
  /* Busca la columna por su clave o por cualquiera de sus alias (AppSheet). */
  const indexOfField = (field: { key: string; aliases?: string[] }): number => {
    const candidates = [field.key, ...(field.aliases ?? [])];
    for (const name of candidates) {
      const idx = headers.indexOf(normalizeHeader(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const indexOf = (key: string): number => headers.indexOf(normalizeHeader(key));

  const idIndex = indexOf(schema.idField);
  const fieldIndexes = schema.fields
    .map((field) => ({ field, index: indexOfField(field) }))
    .filter((entry) => entry.index >= 0);

  if (fieldIndexes.length === 0) {
    result.errors.push(
      `No known column was found. Expected headers such as: ${schema.fields
        .slice(0, 4)
        .map((f) => f.key)
        .join(', ')}…`,
    );
    return result;
  }

  const missing = schema.fields
    .filter((field) => indexOfField(field) < 0)
    .map((field) => field.key);
  if (missing.length > 0) {
    result.errors.push(`Columns not present in the file (saved as empty): ${missing.join(', ')}`);
  }
  if (idIndex < 0) {
    result.errors.push(
      `Column ${schema.idField} is missing: all rows will get a new generated ID instead of the AppSheet one.`,
    );
  }

  /* Resolucion de llaves foraneas: acepta el ID de Firestore o el nombre/numero
     visible (nombre de commodity, # de lote, # de orden) y lo convierte al ID. */
  const refFields = schema.fields.filter((f) => f.ref);
  const refResolvers = new Map<string, Map<string, string>>();
  for (const field of refFields) {
    if (refResolvers.has(field.ref as string)) continue;
    try {
      const refDocs = await listDocuments<{ id: string } & Record<string, unknown>>(field.ref as string);
      const lookup = new Map<string, string>();
      for (const refDoc of refDocs) {
        lookup.set(refDoc.id.trim().toLowerCase(), refDoc.id);
        for (const value of Object.values(refDoc)) {
          if (typeof value === 'string' && value.trim()) lookup.set(value.trim().toLowerCase(), refDoc.id);
        }
      }
      refResolvers.set(field.ref as string, lookup);
    } catch {
      /* Sin resolver: se guarda el valor crudo. */
    }
  }
  const resolveRef = (field: { ref?: string }, raw: string): string => {
    if (!field.ref || !raw) return raw;
    return refResolvers.get(field.ref)?.get(raw.trim().toLowerCase()) ?? raw;
  };

  const docs: Array<{ id?: string } & Record<string, unknown>> = [];

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const cells = matrix[rowIndex];
    result.totalRows += 1;

    const doc: { id?: string } & Record<string, unknown> = {};
    const appsheetId = idIndex >= 0 ? (cells[idIndex] ?? '').trim() : '';
    if (appsheetId) {
      doc.id = appsheetId;
      result.withAppsheetId += 1;
    } else {
      result.generatedId += 1;
    }

    for (const { field, index } of fieldIndexes) {
      const raw = (cells[index] ?? '').trim();
      if (field.type === 'number') doc[field.key] = parseNumberValue(raw);
      else if (field.type === 'boolean') doc[field.key] = parseBooleanValue(raw);
      else if (field.type === 'date') doc[field.key] = parseDateValue(raw);
      else doc[field.key] = resolveRef(field, raw);
    }

    /* TOTAL de linea: si no vino en el archivo, se calcula qty x price. */
    if ('QUANTITY' in doc && 'PRICE' in doc && !(doc.TOTAL as number)) {
      const computed = round2(((doc.QUANTITY as number) ?? 0) * ((doc.PRICE as number) ?? 0));
      if (computed > 0) doc.TOTAL = computed;
    }

    docs.push(doc);
  }

  try {
    result.imported = await bulkUpsert(schema.collection, docs);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error while writing to Firestore.');
    return result;
  }

  /* Totales del padre: al importar lineas, la orden recalcula sus montos. */
  try {
    if (schema.collection === COLLECTIONS.PURCHASE_DETAILS) {
      const parentIds = [...new Set(docs.map((d) => String(d.ID_PURCHASEORDER ?? '')).filter(Boolean))];
      await recomputePurchaseTotals(parentIds);
    } else if (schema.collection === COLLECTIONS.SALES_ORDER_DETAIL) {
      const parentIds = [...new Set(docs.map((d) => String(d.ID_SALESORDER ?? '')).filter(Boolean))];
      await recomputeSalesTotals(parentIds);
    }
  } catch {
    result.errors.push('Lines were imported, but order totals could not be recalculated automatically.');
  }

  return result;
}

/** Recalcula SUBTOTAL/QUANTITY/COMMISION/TOTAL/BALANCE de los lotes afectados. */
async function recomputePurchaseTotals(orderIds: string[]): Promise<void> {
  for (const orderId of orderIds) {
    const lines = await listDocuments<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS, [
      where('ID_PURCHASEORDER', '==', orderId),
    ]);
    const orders = await listDocuments<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
    const order = orders.find((o) => o.id === orderId);
    if (!order) continue;
    const subtotal = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
    const quantity = round2(lines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0));
    const commission = round2((subtotal * (order.COMMISION_PERCENT ?? 0)) / 100);
    const total = round2(subtotal + commission);
    await updateDocument<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, orderId, {
      SUBTOTAL: subtotal,
      QUANTITY: quantity,
      COMMISION_AMOUNT: commission,
      TOTAL: total,
      BALANCE: round2(total - (order.AMOUNT_PAID ?? 0)),
    });
  }
}

/** Recalcula TOTAL/BALANCE de las ordenes de venta afectadas. */
async function recomputeSalesTotals(orderIds: string[]): Promise<void> {
  for (const orderId of orderIds) {
    const lines = await listDocuments<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL, [
      where('ID_SALESORDER', '==', orderId),
    ]);
    const orders = await listDocuments<SalesOrder>(COLLECTIONS.SALES_ORDER);
    const order = orders.find((o) => o.id === orderId);
    if (!order) continue;
    const total = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, orderId, {
      TOTAL: total,
      BALANCE: round2(total - (order.INCOMES ?? 0)),
    });
  }
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
