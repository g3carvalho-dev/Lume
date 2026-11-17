// Recursos comuns às conversas diretas e aos grupos: mensagem citada e GIF.
// Reações, silenciar e leitura ficam em conversations.js. Regras:
// - citar só aponta para mensagem da mesma conversa; a citação mostra só o
//   começo do texto e quem escreveu;
// - GIF aceita só endereços de mídia do Giphy (isGifUrl);
// - nada disso gera XP.
import { isGifUrl } from '../../public/social-emoji.js';
import { AppError } from '../errors.js';

export const REPLY_PREVIEW = 140;

export function gifOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!isGifUrl(value)) throw new AppError('GIF inválido.', 'invalid_gif', 400);
  return value;
}

export function replyIdOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new AppError('Mensagem citada inválida.', 'invalid_reply', 400);
  return value;
}

export function replyPreview(row, names) {
  if (!row) return null;
  const text = String(row.body || '').replace(/\s+/g, ' ').trim();
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: names.get(row.sender_id) || 'Alguém',
    preview: text ? (text.length > REPLY_PREVIEW ? `${text.slice(0, REPLY_PREVIEW)}…` : text) : row.gif_url ? 'GIF' : row.reference ? 'Material compartilhado' : '',
  };
}

// Citação de uma mensagem que não está mais disponível para quem lê.
export function replyOf(row, quoted, names) {
  if (!row.reply_to) return null;
  return replyPreview(quoted.get(row.reply_to), names) || { id: row.reply_to, senderName: '', preview: 'Mensagem indisponível' };
}
