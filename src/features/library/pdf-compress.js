// Compressão de PDF no navegador. Duas rotas:
// - sem perda: re-salva o PDF e só aceita o resultado se páginas, sumário e
//   texto continuarem iguais;
// - digitalização: rasteriza as páginas para JPEG, sob escolha explícita,
//   porque o texto deixa de ser selecionável.

import {
  COMPRESSION, compressionGain, estimatedRasterBytes, hasTextLayer, isLikelyScan,
  isUsefulLossless, isUsefulRaster, pageTextChars, rasterScale, samplePageNumbers,
} from '../../../public/compression-domain.js';
import { inspectPdf, openDocument, readPageText } from './pdf-client.js';

export class PdfCompressionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PdfCompressionError';
    this.code = code;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function pdfLib() {
  return import('pdf-lib');
}

function normalizedOutline(outline = []) {
  return JSON.stringify((outline || []).map((item) => [item.title, item.page]));
}

function normalizedText(text) {
  return String(text || '').replace(/\s+/g, '');
}

function sameDocument(before, after) {
  return Boolean(after)
    && before.pages === after.pages
    && normalizedOutline(before.outline) === normalizedOutline(after.outline)
    && normalizedText(before.text) === normalizedText(after.text);
}

export async function analyzePdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // O pdf.js transfere o buffer para o worker; guarde a cópia usada depois.
  const { doc, close } = await openDocument(bytes.slice());
  try {
    const pages = doc.numPages;
    const samples = [];
    for (const number of samplePageNumbers(pages)) {
      const { text } = await readPageText(doc, number).catch(() => ({ text: '' }));
      samples.push(pageTextChars(text));
    }
    const meta = await doc.getMetadata().catch(() => null);
    return {
      bytes,
      pages,
      samples,
      scan: isLikelyScan(samples),
      text: hasTextLayer(samples),
      title: String(meta?.info?.Title || '').trim(),
    };
  } finally {
    await close().catch(() => {});
  }
}

export async function optimizePdfLossless(file, analysis = null) {
  const source = analysis?.bytes || new Uint8Array(await file.arrayBuffer());
  const before = source.byteLength;
  let output;
  try {
    const { PDFDocument } = await pdfLib();
    const document = await PDFDocument.load(source, { updateMetadata: false });
    output = await document.save({ useObjectStreams: true, addDefaultPage: false });
  } catch {
    return null;
  }
  if (!isUsefulLossless(before, output.byteLength)) return null;

  // O pdf-lib pode alterar recursos raros (formulários, assinaturas). Só
  // publica o resultado se o pdf.js enxergar o mesmo documento.
  const original = await inspectPdf(file).catch(() => null);
  if (!original) return null;
  const blob = new Blob([output], { type: 'application/pdf' });
  const result = await inspectPdf(blob).catch(() => null);
  if (!sameDocument(original, result)) return null;

  return {
    blob,
    bytes: output,
    pages: result.pages,
    outline: result.outline,
    title: result.title || original.title,
    mode: 'lossless',
    before,
    after: output.byteLength,
    gain: compressionGain(before, output.byteLength),
  };
}

export async function estimatePdfRaster(file, analysis, { targetBytes = Infinity } = {}) {
  if (!analysis?.scan || analysis.pages < 1 || analysis.pages > COMPRESSION.pdfPagesLimit) return null;
  if (analysis.bytes.byteLength <= 1.5 * 1024 * 1024) return null;

  const { doc, close } = await openDocument(analysis.bytes.slice());
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: rasterScale(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvas, viewport, background: '#fff' }).promise;

    let smallest = null;
    for (const quality of COMPRESSION.rasterQualities) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (blob && (!smallest || blob.size < smallest.size)) smallest = blob;
    }
    if (!smallest) return null;
    const estimatedBytes = estimatedRasterBytes(smallest.size, analysis.pages);
    if (!isUsefulRaster(analysis.bytes.byteLength, estimatedBytes)) return null;
    if (estimatedBytes > targetBytes) return null;
    return {
      estimatedBytes,
      firstPageBytes: smallest.size,
      gain: compressionGain(analysis.bytes.byteLength, estimatedBytes),
    };
  } finally {
    await close().catch(() => {});
  }
}

export async function rasterizePdf(file, analysis, {
  targetBytes = Infinity,
  onProgress = null,
  signal = null,
} = {}) {
  if (!analysis?.scan) throw new PdfCompressionError('Este PDF tem texto e não pode ser rasterizado.', 'text_layer');
  if (analysis.pages > COMPRESSION.pdfPagesLimit) {
    throw new PdfCompressionError(`PDFs com mais de ${COMPRESSION.pdfPagesLimit} páginas não entram na redução para digitalização.`, 'too_many_pages');
  }

  const { PDFDocument } = await pdfLib();
  const outputDocument = await PDFDocument.create();
  outputDocument.setTitle(analysis.title || file.name || 'PDF');
  const { doc, close } = await openDocument(analysis.bytes.slice());
  try {
    const pageBudget = Math.max(48 * 1024, Math.floor(targetBytes / analysis.pages * 0.86));
    for (let number = 1; number <= analysis.pages; number += 1) {
      if (signal?.aborted) throw new DOMException('Compressão cancelada.', 'AbortError');
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: rasterScale(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new PdfCompressionError('Não foi possível preparar a imagem desta página.', 'render_failed');
      await page.render({ canvas, viewport, background: '#fff' }).promise;

      let jpeg = null;
      for (const quality of COMPRESSION.rasterQualities) {
        const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        if (!blob) continue;
        if (!jpeg || blob.size < jpeg.size) jpeg = blob;
        if (blob.size <= pageBudget) {
          jpeg = blob;
          break;
        }
      }
      if (!jpeg) throw new PdfCompressionError('Não foi possível comprimir esta página.', 'render_failed');

      const image = await outputDocument.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      const target = outputDocument.addPage([base.width, base.height]);
      target.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
      page.cleanup?.();
      onProgress?.(number, analysis.pages);
    }

    const output = await outputDocument.save({ useObjectStreams: true });
    if (output.byteLength > targetBytes) {
      throw new PdfCompressionError('A redução não foi suficiente para caber no limite. Tente outro PDF ou divida o arquivo.', 'still_too_large');
    }
    if (!isUsefulRaster(analysis.bytes.byteLength, output.byteLength)) {
      throw new PdfCompressionError('Este PDF já está otimizado; a redução não compensa.', 'no_gain');
    }
    return {
      blob: new Blob([output], { type: 'application/pdf' }),
      bytes: output,
      pages: analysis.pages,
      outline: [],
      title: analysis.title || file.name,
      mode: 'raster',
      before: analysis.bytes.byteLength,
      after: output.byteLength,
      gain: compressionGain(analysis.bytes.byteLength, output.byteLength),
    };
  } finally {
    await close().catch(() => {});
  }
}

export function pdfFileFrom(result, name = 'documento.pdf') {
  if (result?.blob instanceof File) return result.blob;
  return new File([result.bytes || result.blob], name, { type: 'application/pdf' });
}
