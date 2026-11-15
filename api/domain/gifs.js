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

async function requestGifs(env, { query = '', limit = LIMIT, trending = false }, fetchImpl) {
  const text = String(query || '').trim().slice(0, 60);
  const params = new URLSearchParams({ api_key: String(env.LUME_GIF_API_KEY).trim(), limit: String(limit), rating: 'g' });
  if (text && !trending) { params.set('q', text); params.set('lang', 'pt'); }
  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}/${text && !trending ? 'search' : 'trending'}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError('Não foi possível buscar GIFs agora.', 'gif_unavailable', 502);
  }
  if (!response.ok) throw new AppError('Não foi possível buscar GIFs agora.', 'gif_unavailable', 502);
  const data = await response.json().catch(() => null);
  return (Array.isArray(data?.data) ? data.data : []).map((item) => {
    // Publicações e comentários usam a versão média (até ~480 px); a miniatura é a pequena.
    const medium = item?.images?.downsized_medium?.url;
    const full = isGifUrl(medium) ? medium : item?.images?.fixed_width?.url;
    const preview = item?.images?.fixed_width_small?.url || full;
    return isGifUrl(full) && isGifUrl(preview) ? { id: String(item.id || ''), title: String(item.title || '').slice(0, 120), url: full, preview } : null;
  }).filter(Boolean);
}

export async function searchGifs(env, query = '', fetchImpl = fetch) {
  if (!gifsAvailable(env)) return { available: false, gifs: [] };
  return { available: true, gifs: await requestGifs(env, { query }, fetchImpl) };
}

// Categorias da tela inicial do seletor: cada uma mostra um GIF de capa. As
// capas ficam em cache por algumas horas para não gastar a cota do provedor.
export const GIF_CATEGORIES = [
  { id: 'trending', title: 'GIFs em alta', trending: true },
  { id: 'hello', title: 'Olá', query: 'hello' },
  { id: 'lol', title: 'Rindo', query: 'lol' },
  { id: 'love', title: 'Amor', query: 'love' },
  { id: 'birthday', title: 'Parabéns', query: 'happy birthday' },
  { id: 'study', title: 'Estudando', query: 'studying' },
];
const COVER_TTL_MS = 6 * 60 * 60 * 1000;
const covers = new Map();

export async function gifCategories(env, fetchImpl = fetch, { cache = covers, now = Date.now() } = {}) {
  if (!gifsAvailable(env)) return { available: false, categories: [] };
  const categories = await Promise.all(GIF_CATEGORIES.map(async (item) => {
    const hit = cache.get(item.id);
    let preview = hit && now - hit.at < COVER_TTL_MS ? hit.preview : null;
    if (preview === null) {
      preview = '';
      try { preview = (await requestGifs(env, { query: item.query, trending: item.trending, limit: 1 }, fetchImpl))[0]?.preview || ''; } catch { /* a categoria aparece sem capa */ }
      if (preview) cache.set(item.id, { preview, at: now });
    }
    return { id: item.id, title: item.title, query: item.query || '', trending: Boolean(item.trending), preview };
  }));
  return { available: true, categories };
}
