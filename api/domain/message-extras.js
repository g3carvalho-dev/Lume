// Recursos comuns às conversas diretas e aos grupos: mensagem citada, GIF,
// reações em emoji e conversa silenciada. Regras:
// - citar só aponta para mensagem da mesma conversa; a citação mostra só o
//   começo do texto e quem escreveu;
// - reações usam só os emojis de public/social-emoji.js, uma por pessoa e emoji;
// - GIF aceita só endereços de mídia do Giphy (isGifUrl);
// - silenciar tira a conversa do contador do menu e do aviso flutuante, sem
//   apagar nada; as mensagens continuam chegando e ficam marcadas como não lidas;
// - nada disso gera XP.
import { DEFAULT_REACTION, isAllowedEmoji, isGifUrl } from '../../public/social-emoji.js';
import { MessagesError } from './messages.js';

export const REPLY_PREVIEW = 140;
const iso = (now) => new Date(now).toISOString();

export function gifOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!isGifUrl(value)) throw new MessagesError('GIF inválido.', 'invalid_gif', 400);
  return value;
}

export function emojiOf(value) {
  const emoji = value || DEFAULT_REACTION;
  if (!isAllowedEmoji(emoji)) throw new MessagesError('Escolha um emoji da lista.', 'invalid_emoji', 400);
  return emoji;
}

export function replyIdOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new MessagesError('Mensagem citada inválida.', 'invalid_reply', 400);
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

// Resumo das reações de várias mensagens numa consulta: Map(id → [{ emoji, count, mine }]).
export async function reactionSummaries(db, scope, userId, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.all(
    `SELECT message_id, emoji, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM message_reactions
      WHERE scope = ? AND message_id IN (${ids.map(() => '?').join(', ')})
      GROUP BY message_id, emoji ORDER BY MIN(created_at), emoji`,
    [userId, scope, ...ids],
  );
  for (const row of rows) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push({ emoji: row.emoji, count: Number(row.n), mine: Number(row.mine) > 0 });
  }
  return map;
}

export async function setReaction(db, scope, userId, messageId, emoji, on, now = Date.now()) {
  const chosen = emojiOf(emoji);
  if (on) {
    await db.run(
      'INSERT OR IGNORE INTO message_reactions (scope, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)',
      [scope, messageId, userId, chosen, iso(now)],
    );
  } else {
    await db.run('DELETE FROM message_reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?', [scope, messageId, userId, chosen]);
  }
  return { reacted: on, emoji: chosen, messageId };
}

export async function isMuted(db, userId, scope, targetId) {
  return Boolean(await db.first('SELECT 1 AS ok FROM conversation_mutes WHERE user_id = ? AND scope = ? AND target_id = ?', [userId, scope, targetId]));
}

export async function setMuted(db, userId, scope, targetId, muted, now = Date.now()) {
  if (typeof muted !== 'boolean') throw new MessagesError('Escolha se quer silenciar a conversa.', 'invalid_preference', 400);
  if (muted) {
    await db.run('INSERT OR IGNORE INTO conversation_mutes (user_id, scope, target_id, created_at) VALUES (?, ?, ?, ?)', [userId, scope, targetId, iso(now)]);
  } else {
    await db.run('DELETE FROM conversation_mutes WHERE user_id = ? AND scope = ? AND target_id = ?', [userId, scope, targetId]);
  }
  return { muted };
}
