// Compressão local de imagens: o arquivo original nunca sai do navegador.
// Usado por Social, slides e perfil; o servidor recebe só o resultado.

import { COMPRESSION } from '../../public/compression-domain.js';

export class ImageCompressionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ImageCompressionError';
    this.code = code;
  }
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function readBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

function canvasWithImage(bitmap, width, height, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new ImageCompressionError('Não foi possível processar esta imagem.', 'unprocessable');
  if (crop) {
    const scale = Math.max(canvas.width / (bitmap.width || canvas.width), canvas.height / (bitmap.height || canvas.height));
    const drawWidth = (bitmap.width || canvas.width) * scale;
    const drawHeight = (bitmap.height || canvas.height) * scale;
    context.drawImage(bitmap, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

// JPEG não tem transparência: pinta fundo branco em vez de deixar o alfa virar preto.
function opaqueCopy(canvas) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, copy.width, copy.height);
  context.drawImage(canvas, 0, 0);
  return copy;
}

function result(blob, before, changed) {
  return { blob, before, after: blob.size, changed: Boolean(changed) };
}

export async function compressImage(file, {
  maxBytes = 2 * 1024 * 1024,
  maxWidth = 1920,
  maxHeight = 1920,
  crop = null,
  sourceBytes = COMPRESSION.imageSourceBytes,
  qualities = COMPRESSION.imageQualities,
  formats = ['image/webp', 'image/jpeg'],
  keepGifUnder = maxBytes,
  force = false,
} = {}) {
  if (!file || !IMAGE_TYPES.has(file.type)) {
    throw new ImageCompressionError('Escolha um arquivo de imagem (PNG, JPG, WebP ou GIF).', 'not_image');
  }
  if (file.size > sourceBytes) {
    throw new ImageCompressionError('A imagem escolhida é muito pesada (máximo 12 MB).', 'too_large');
  }
  if (file.type === 'image/gif' && file.size <= keepGifUnder) {
    return result(file, file.size, false);
  }
  // Sem corte, uma imagem que já cabe não precisa ser recodificada,
  // exceto quando a otimização de um anexo existente pede uma tentativa.
  if (!crop && !force && file.size <= maxBytes) return result(file, file.size, false);

  let bitmap;
  try {
    bitmap = await readBitmap(file);
  } catch {
    throw new ImageCompressionError('Não foi possível processar esta imagem.', 'unprocessable');
  }

  try {
    const naturalWidth = bitmap.width || 1;
    const naturalHeight = bitmap.height || 1;
    let width = naturalWidth;
    let height = naturalHeight;
    if (crop) {
      width = crop.width;
      height = crop.height;
    } else if (maxWidth || maxHeight) {
      const scale = Math.min(
        1,
        maxWidth ? maxWidth / naturalWidth : 1,
        maxHeight ? maxHeight / naturalHeight : 1,
      );
      width = naturalWidth * scale;
      height = naturalHeight * scale;
    }

    let canvas = canvasWithImage(bitmap, width, height, crop);
    let smallest = null;
    for (const quality of qualities) {
      for (const format of formats) {
        const target = format === 'image/jpeg' && file.type !== 'image/jpeg' ? opaqueCopy(canvas) : canvas;
        const blob = await canvasToBlob(target, format, quality);
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= maxBytes) {
          return { blob, before: file.size, after: blob.size, width: canvas.width, height: canvas.height, changed: true };
        }
      }
    }
    if (smallest && smallest.size <= maxBytes) {
      return { blob: smallest, before: file.size, after: smallest.size, width: canvas.width, height: canvas.height, changed: true };
    }
    throw new ImageCompressionError('A imagem ficou grande demais mesmo após otimizar. Tente outra imagem.', 'still_too_large');
  } finally {
    bitmap.close?.();
  }
}
