/**
 * Utilidades de parseo de CSV y conversion de valores.
 * Sin dependencias externas: soporta comillas, delimitadores , ; y tab, CRLF y BOM.
 */

/** Detecta el delimitador mas probable en la primera linea del archivo. */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Convierte el texto completo de un CSV en una matriz de celdas. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const sep = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** "$12,960.00" | "12.960,00" | "1234" -> 12960 */
export function parseNumberValue(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;

  if (lastComma > lastDot) {
    // Formato europeo: 12.960,00 -> el separador decimal es la coma
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Formato US: 12,960.00 -> las comas son separador de miles
    normalized = cleaned.replace(/,/g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

const TRUE_VALUES = new Set(['true', 'yes', 'y', 'si', 'sí', '1', 'x', 'verdadero']);

export function parseBooleanValue(raw: string): boolean {
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Normaliza fechas a ISO yyyy-mm-dd.
 * Acepta yyyy-mm-dd, m/d/yyyy (formato por defecto de AppSheet US),
 * d/m/yyyy cuando el primer numero es mayor a 12, y numeros seriales de Excel.
 */
export function parseDateValue(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(value);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    // Si el primer numero no puede ser mes, se asume d/m/yyyy
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Serial de Excel (dias desde 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (serial > 20000 && serial < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/** Normaliza encabezados para poder emparejarlos aunque cambien mayusculas o espacios. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s\-.]+/g, '_');
}
