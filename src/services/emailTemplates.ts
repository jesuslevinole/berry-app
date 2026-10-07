/**
 * Plantillas de correo por documento: asunto y mensaje guardados, con variables
 * que se llenan en cada envio ({{customer}}, {{number}}, {{total}}...).
 * Incluye la limpieza del HTML del editor (solo formato seguro para correo).
 */
import type { EmailDocType } from '../types/models';

export interface TemplateVariable {
  key: string;
  label: string;
}

/** Variables disponibles por documento (se insertan con un clic en el editor). */
const SALES_VARS: TemplateVariable[] = [
  { key: 'number', label: '# Sales order' },
  { key: 'customer', label: 'Customer' },
  { key: 'ref', label: 'Ref' },
  { key: 'total', label: 'Total' },
  { key: 'date', label: 'Date' },
  { key: 'due_date', label: 'Due date' },
  { key: 'company', label: 'Company' },
];

const STATEMENT_VARS: TemplateVariable[] = [
  { key: 'customer', label: 'Customer' },
  { key: 'total', label: 'Aging total' },
  { key: 'count', label: '# Invoices' },
  { key: 'start_date', label: 'Start date' },
  { key: 'end_date', label: 'End date' },
  { key: 'company', label: 'Company' },
];

export const variablesFor = (doc: EmailDocType): TemplateVariable[] => (doc === 'statement' ? STATEMENT_VARS : SALES_VARS);

/** Plantilla inicial de cada documento (hasta que se guarde una propia). */
const DEFAULTS: Record<EmailDocType, { subject: string; body: string }> = {
  invoice: {
    subject: 'Invoice {{number}} — {{customer}}',
    body: '<p>Hello,</p><p>Please find attached <b>Invoice {{number}}</b> (Ref {{ref}}) for <b>{{total}}</b>.</p><p>Thank you for your business,<br>{{company}}</p>',
  },
  pick: {
    subject: 'Pick Ticket {{number}} — {{customer}}',
    body: '<p>Hello,</p><p>Please find attached the <b>Pick Ticket</b> for sales order <b>{{number}}</b> (Ref {{ref}}).</p><p>Thank you,<br>{{company}}</p>',
  },
  so: {
    subject: 'Sales Order {{number}} — {{customer}}',
    body: '<p>Hello,</p><p>Please find attached <b>Sales Order {{number}}</b> (Ref {{ref}}).</p><p>Thank you,<br>{{company}}</p>',
  },
  bol: {
    subject: 'Bill of Lading {{number}} — {{customer}}',
    body: '<p>Hello,</p><p>Please find attached the <b>Bill of Lading</b> for sales order <b>{{number}}</b> (Ref {{ref}}).</p><p>Thank you,<br>{{company}}</p>',
  },
  statement: {
    subject: 'Account statement — {{customer}}',
    body: '<p>Hello {{customer}},</p><p>Please find attached your account statement with <b>{{count}}</b> pending invoices for a total of <b>{{total}}</b>.</p><p>If you have already sent payment, please disregard this message.</p><p>Thank you,<br>{{company}}</p>',
  },
};

export const defaultTemplate = (doc: EmailDocType): { subject: string; body: string } => DEFAULTS[doc];

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** Llena las variables. En HTML los valores se escapan; las desconocidas se dejan tal cual. */
export function fillTemplate(text: string, values: Record<string, string>, asHtml = false): string {
  return text.replace(VAR_RE, (match, key: string) => {
    const value = values[key.toLowerCase()];
    if (value === undefined) return match;
    return asHtml ? escapeHtml(value) : value;
  });
}

/* ---------------- Limpieza del HTML del editor ---------------- */

const ALLOWED_TAGS = new Set([
  'p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'font', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'blockquote',
]);
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math']);
const ALLOWED_STYLES = new Set(['font-weight', 'font-style', 'text-decoration', 'color', 'font-size', 'text-align', 'background-color']);
const SAFE_STYLE_VALUE = /^[#(),.%\w\s-]+$/;

function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((rule) => rule.split(':').map((p) => p.trim()))
    .filter(([prop, value]) => prop && value && ALLOWED_STYLES.has(prop.toLowerCase()) && SAFE_STYLE_VALUE.test(value) && !/url|expression/i.test(value))
    .map(([prop, value]) => `${prop.toLowerCase()}: ${value}`)
    .join('; ');
}

function cleanNode(node: Node, out: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return out.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  /* Etiquetas peligrosas: se descartan con todo su contenido. */
  if (DROP_TAGS.has(tag)) return null;
  const children = [...el.childNodes].map((c) => cleanNode(c, out)).filter((c): c is Node => !!c);

  /* Etiqueta no permitida: se conserva solo su contenido. */
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = out.createDocumentFragment();
    children.forEach((c) => fragment.appendChild(c));
    return fragment;
  }

  const clean = out.createElement(tag);
  children.forEach((c) => clean.appendChild(c));
  const style = el.getAttribute('style');
  if (style) {
    const safe = cleanStyle(style);
    if (safe) clean.setAttribute('style', safe);
  }
  if (tag === 'font') {
    const size = el.getAttribute('size');
    const color = el.getAttribute('color');
    if (size && /^[1-7]$/.test(size)) clean.setAttribute('size', size);
    if (color && /^#?[\w]{3,8}$/.test(color)) clean.setAttribute('color', color);
  }
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) {
      clean.setAttribute('href', href);
      clean.setAttribute('target', '_blank');
      clean.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return clean;
}

/** Deja solo formato seguro (negritas, cursivas, tamanos, colores, listas, enlaces). */
export function sanitizeEmailHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const wrapper = out.createElement('div');
  [...parsed.body.childNodes].forEach((c) => {
    const cleaned = cleanNode(c, out);
    if (cleaned) wrapper.appendChild(cleaned);
  });
  return wrapper.innerHTML;
}

/** Cuerpo final del correo: fuente legible y tamano base. */
export const wrapEmailHtml = (bodyHtml: string): string =>
  `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1c1c1c;">${bodyHtml}</div>`;

/** yyyy-mm-dd -> m/d/yyyy (formato de EE. UU. para los correos). */
export const usDate = (iso?: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};
