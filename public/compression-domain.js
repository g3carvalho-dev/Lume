// Regras de compressão de arquivos no navegador. O servidor continua sendo a
// autoridade da cota; aqui ficam só os limites e as decisões que a interface e
// os testes compartilham.

export const MB = 1024 * 1024;

export const COMPRESSION = Object.freeze({
  // Arquivo de entrada aceito para otimizar. O resultado precisa caber na cota.
  pdfSourceBytes: 30 * MB,
  imageSourceBytes: 12 * MB,
  // Digitalizações acima deste tamanho ficam sem rasterização para não travar
  // o navegador; a compressão sem perda continua disponível.
  pdfPagesLimit: 300,
  samplePages: 8,
  textCharsPerPage: 40,
  scanDpi: 150,
  maxRenderPixels: 2200,
  losslessMinGain: 0.03,
  losslessMinBytes: 8 * 1024,
  rasterMinGain: 0.2,
  rasterQualities: Object.freeze([0.82, 0.72, 0.62, 0.52]),
  imageQualities: Object.freeze([0.9, 0.82, 0.72, 0.62]),
});

export function samplePageNumbers(total, count = COMPRESSION.samplePages) {
  const pages = Math.max(0, Math.trunc(Number(total) || 0));
  const wanted = Math.max(1, Math.trunc(Number(count) || 1));
  if (pages === 0) return [];
  if (pages <= wanted) return Array.from({ length: pages }, (_, index) => index + 1);
  const step = (pages - 1) / (wanted - 1);
  return [...new Set(Array.from({ length: wanted }, (_, index) => Math.round(1 + step * index)))];
}

export function pageTextChars(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

function sampleChars(samples = []) {
  return samples.map((sample) => (typeof sample === 'number' ? sample : Number(sample?.chars) || 0));
}

// Só é digitalização quando todas as páginas amostradas têm pouquíssimo texto.
// PDF misto (texto + páginas escaneadas) não entra no caminho com perda.
export function isLikelyScan(samples = []) {
  const values = sampleChars(samples);
  return values.length > 0 && values.every((chars) => chars < COMPRESSION.textCharsPerPage);
}

export function hasTextLayer(samples = []) {
  return sampleChars(samples).some((chars) => chars >= COMPRESSION.textCharsPerPage);
}

export function compressionGain(before, after) {
  const original = Number(before) || 0;
  const result = Number(after) || 0;
  if (original <= 0 || result < 0 || result >= original) return 0;
  return (original - result) / original;
}

function useful(before, after, minGain, minBytes) {
  const saved = (Number(before) || 0) - (Number(after) || 0);
  return saved >= minBytes && compressionGain(before, after) >= minGain;
}

export function isUsefulLossless(before, after) {
  return useful(before, after, COMPRESSION.losslessMinGain, COMPRESSION.losslessMinBytes);
}

export function isUsefulRaster(before, after) {
  return useful(before, after, COMPRESSION.rasterMinGain, COMPRESSION.losslessMinBytes);
}

export function rasterScale(pageWidth, pageHeight, {
  dpi = COMPRESSION.scanDpi,
  maxPixels = COMPRESSION.maxRenderPixels,
} = {}) {
  const width = Math.max(1, Number(pageWidth) || 1);
  const height = Math.max(1, Number(pageHeight) || 1);
  const desired = Math.max(1, Number(dpi) || COMPRESSION.scanDpi) / 72;
  const cap = Math.max(1, Number(maxPixels) || COMPRESSION.maxRenderPixels);
  return Math.min(desired, cap / Math.max(width, height));
}

export function estimatedRasterBytes(firstPageBytes, pages) {
  const first = Math.max(0, Number(firstPageBytes) || 0);
  const total = Math.max(0, Math.trunc(Number(pages) || 0));
  return Math.round(first * total * 1.04);
}

export function canRasterize(analysis, targetBytes) {
  if (!analysis?.scan) return false;
  const pages = Math.trunc(Number(analysis.pages) || 0);
  if (pages < 1 || pages > COMPRESSION.pdfPagesLimit) return false;
  const estimate = Number(analysis.estimatedBytes) || 0;
  if (!estimate) return true;
  return estimate <= Math.max(0, Number(targetBytes) || estimate);
}

export function nextQuality(qualities = COMPRESSION.rasterQualities, current = null) {
  const list = [...qualities];
  if (current == null) return list[0] ?? 0.7;
  const index = list.indexOf(current);
  return index >= 0 && index < list.length - 1 ? list[index + 1] : list.at(-1) ?? 0.5;
}
