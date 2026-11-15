// Processamento local da imagem; somente o resultado otimizado vai à API.
import { compressImage } from '../../lib/image-compress.js';

const PROFILE_BYTES = 2 * 1024 * 1024;
const SOURCE_BYTES = 12 * 1024 * 1024;

// `options` escolhe o corte (avatar) ou só a redução proporcional (capa, que a pessoa enquadra depois).
export async function prepareProfileImageBlob(file, options) {
  try {
    const { blob } = await compressImage(file, {
      maxBytes: PROFILE_BYTES,
      sourceBytes: SOURCE_BYTES,
      ...options,
      qualities: [0.86, 0.74, 0.6],
      formats: ['image/webp', 'image/jpeg'],
      keepGifUnder: PROFILE_BYTES,
    });
    return blob;
  } catch (error) {
    if (error?.code === 'not_image') throw new Error('Escolha um arquivo de imagem (PNG, JPG, WebP ou GIF).');
    if (error?.code === 'too_large') throw new Error('A imagem escolhida é muito pesada (máximo 12 MB).');
    if (error?.code === 'still_too_large') throw new Error('A imagem ficou grande demais mesmo após otimizar. Tente outra imagem.');
    if (error?.code === 'unprocessable' && file?.size <= PROFILE_BYTES) return file;
    throw new Error('Não foi possível processar esta imagem.');
  }
}

export async function uploadProfileBlob(slot, blob) {
  const response = await fetch(`/api/profile/media/${encodeURIComponent(slot)}`, {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) throw new Error(data?.error || 'Não foi possível enviar a imagem para o servidor.');
  return data.url;
}
