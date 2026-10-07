/**
 * Convierte uno de los documentos HTML de la app (Invoice, Statement...) en un PDF
 * para adjuntarlo a un correo. Se pinta en un iframe oculto con el estilo de impresion,
 * se captura la hoja (.page) y se arma el PDF en tamano carta. Las librerias se cargan
 * solo cuando se usan, asi no pesan en la carga inicial de la app.
 */

export interface PdfOptions {
  orientation?: 'portrait' | 'landscape';
}

/** Estilos que imitan la impresion: sin barra de imprimir, sin sombra, fondo blanco. */
const PRINT_LIKE = `
  .print-bar { display: none !important; }
  html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
  .page { box-shadow: none !important; margin: 0 auto !important; }
`;

const waitForImages = async (doc: Document): Promise<void> => {
  await Promise.all(
    [...doc.images].map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      }),
    ),
  );
};

/** Devuelve el PDF en base64 (sin el prefijo data:), listo para la API de correo. */
export async function htmlToPdfBase64(html: string, options: PdfOptions = {}): Promise<string> {
  const orientation = options.orientation ?? 'portrait';
  const [{ jsPDF }, html2canvasModule] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const html2canvas = html2canvasModule.default;

  /* Ancho de la hoja en pixeles CSS (carta a 96 dpi, menos margenes). */
  const sheetWidthPx = orientation === 'landscape' ? 1056 : 816;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  /* Fuera de la pantalla, con el ancho de la hoja para que el layout sea el de impresion. */
  iframe.className = 'pdf-render-frame';
  iframe.width = String(sheetWidthPx);
  iframe.height = '1400';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Could not prepare the document.');
    doc.open();
    doc.write(html.replace('</head>', `<style>${PRINT_LIKE}</style></head>`));
    doc.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await waitForImages(doc);
    if (doc.fonts?.ready) await doc.fonts.ready;

    const target = (doc.querySelector('.page') as HTMLElement | null) ?? doc.body;
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });

    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'letter' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 18;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    const usableH = pageH - margin * 2;

    if (imgH <= usableH) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, imgH);
    } else {
      /* Documento largo: se corta en hojas. */
      const sliceHeightPx = Math.floor((usableH * canvas.width) / imgW);
      let offset = 0;
      let first = true;
      while (offset < canvas.height) {
        const height = Math.min(sliceHeightPx, canvas.height - offset);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = height;
        slice.getContext('2d')?.drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height);
        if (!first) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, (height * imgW) / canvas.width);
        offset += height;
        first = false;
      }
    }

    const dataUri = pdf.output('datauristring');
    return dataUri.slice(dataUri.indexOf(',') + 1);
  } finally {
    iframe.remove();
  }
}
