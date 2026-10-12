/**
 * Adjuntos de pagos (foto del cheque, comprobante en PDF). Se guardan en su propia
 * coleccion (BD_ATTACHMENTS) y el pago solo lleva la referencia "att:<id>" en PHOTO,
 * asi las listas de pagos siguen siendo livianas. Sin Firebase Storage (plan Spark):
 * las imagenes se reducen y el archivo debe caber en un documento (~1 MB).
 */
import { createDocument, getDocument } from './firestore';
import { COLLECTIONS, type BaseDoc } from '../types/models';

interface AttachmentDoc extends BaseDoc {
  NAME: string;
  TYPE: string;
  DATA: string;
}

/** Limite del contenido en base64 (un documento de Firestore admite 1 MiB). */
const MAX_DATA_CHARS = 950_000;
const MAX_IMAGE_SIDE = 1600;

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });

/** Reduce una foto (lado mayor 1600 px, JPEG) hasta que quepa. */
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('The image could not be opened.'));
      el.src = url;
    });
    let side = MAX_IMAGE_SIDE;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.78);
      if (data.length <= MAX_DATA_CHARS) return data;
      side = Math.round(side * 0.75);
    }
    throw new Error('The image is too large.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Guarda el archivo y devuelve la referencia para el campo PHOTO del pago. */
export async function saveAttachment(file: File): Promise<string> {
  let data: string;
  if (file.type.startsWith('image/')) {
    data = await compressImage(file);
  } else if (file.type === 'application/pdf') {
    data = await readAsDataUrl(file);
    if (data.length > MAX_DATA_CHARS) throw new Error('The PDF is too large (max. about 700 KB). Scan it at a lower resolution.');
  } else {
    throw new Error('Attach a photo or a PDF.');
  }
  const id = await createDocument<AttachmentDoc>(COLLECTIONS.ATTACHMENTS, {
    NAME: file.name.slice(0, 120),
    TYPE: file.type.startsWith('image/') ? 'image/jpeg' : file.type,
    DATA: data,
  });
  return `att:${id}`;
}

/** Abre el adjunto de un pago (referencia att: o un enlace normal) en otra pestaña. */
export async function openAttachment(photo: string): Promise<void> {
  if (!photo) return;
  if (!photo.startsWith('att:')) {
    window.open(photo, '_blank', 'noopener');
    return;
  }
  /* La pestaña se abre antes de leer para que el navegador no la bloquee. */
  const win = window.open('', '_blank');
  const att = await getDocument<AttachmentDoc>(COLLECTIONS.ATTACHMENTS, photo.slice(4));
  if (!att?.DATA) {
    win?.close();
    alert('The attachment was not found.');
    return;
  }
  const blob = await (await fetch(att.DATA)).blob();
  const url = URL.createObjectURL(blob);
  if (win) win.location.href = url;
  else window.open(url, '_blank');
}
