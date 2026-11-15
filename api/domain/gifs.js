// Busca de GIFs pelo servidor (Giphy). A chave fica só no servidor; o navegador
// recebe apenas endereços validados dos servidores de mídia do provedor.
import { AppError } from '../errors.js';
import { isGifUrl } from '../../public/social-emoji.js';

const ENDPOINT = 'https://api.giphy.com/v1/gifs';
const LIMIT = 24;
const TIMEOUT_MS = 8000;

export function gifsAvailable(env = {}) {
  return Boolean(String(env?.LUME_GIF_API_KEY || '').trim());
}

export async function searchGifs(env, query = '', fetchImpl = fetch) {
  if (!gifsAvailable(env)) return { available: false, gifs: [] };
  const text = String(query || '').trim().slice(0, 60);
  const params = new URLSearchParams({ api_key: String(env.LUME_GIF_API_KEY).trim(), limit: String(LIMIT), rating: 'g' });
  if (text) { params.set('q', text); params.set('lang', 'pt'); }
  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}/${text ? 'search' : 'trending'}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError('Não foi possível buscar GIFs agora.', 'gif_unavailable', 502);
  }
  if (!response.ok) throw new AppError('Não foi possível buscar GIFs agora.', 'gif_unavailable', 502);
  const data = await response.json().catch(() => null);
  const gifs = (Array.isArray(data?.data) ? data.data : []).map((item) => {
    const full = item?.images?.fixed_width?.url;
    const preview = item?.images?.fixed_width_small?.url || full;
    return isGifUrl(full) && isGifUrl(preview) ? { id: String(item.id || ''), title: String(item.title || '').slice(0, 120), url: full, preview } : null;
  }).filter(Boolean);
  return { available: true, gifs };
}
