// Armazenamento comum das conversas diretas e dos grupos (migração 0027).
//
// - O id da mensagem é ordenável: 13 dígitos de milissegundos, '-', uuid. A chave
//   primária (conversa, id) já é a ordem cronológica, então o id serve de cursor
//   de página (`before`/`after`) e de marca de leitura (`last_read_id`).
// - Cada mensagem grava uma linha. A leitura é por pessoa na conversa.
// - As regras de quem pode conversar ficam em messages.js (amizade, bloqueio) e
//   groups.js (participação, dona do grupo); aqui só há leitura e gravação.
import { DEFAULT_REACTION, isAllowedEmoji } from '../../public/social-emoji.js';
import { AppError } from '../errors.js';

export const PAGE_LIMIT = 50;
export const PAGE_LIMIT_MAX = 100;
// Repetir o mesmo envio dentro desta janela devolve a mensagem já gravada.
export const RESEND_WINDOW_MS = 10 * 60 * 1000;

const stamp = (now) => String(Math.max(0, Math.trunc(now))).padStart(13, '0');
const iso = (now) => new Date(now).toISOString();
const ID = /^[A-Za-z0-9_-]{1,120}$/;

function invalid(message, code) {
  return new AppError(message, code, 400);
}

export function messageId(now, clientId = '') {
  return `${stamp(now)}-${clientId || crypto.randomUUID()}`;
}

// '~' ordena depois de qualquer id criado até este instante.
export function readCursor(now) {
  return `${stamp(now)}~`;
}

// Chave da conversa direta: os dois ids em ordem. Os ids são ASCII, então a
// comparação do JavaScript e a do SQLite coincidem.
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function clientIdOf(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value)) throw invalid('Identificador de envio inválido.', 'invalid_client_id');
  return value;
}

// Opções de página vindas da query string.
export function pageOptions(searchParams) {
  const cursor = (name) => {
    const value = searchParams?.get(name);
    if (!value) return '';
    if (!ID.test(value)) throw invalid('Página inválida.', 'invalid_cursor');
    return value;
  };
  const before = cursor('before');
  const after = before ? '' : cursor('after');
  const asked = Number(searchParams?.get('limit'));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, PAGE_LIMIT_MAX) : PAGE_LIMIT;
  return { before, after, limit };
}

const HIDDEN = 'NOT EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = ? AND b.blocked_id = m.sender_id)';
const COLUMNS = 'm.id, m.sender_id, m.kind, m.body, m.reference, m.gif_url, m.reply_to, m.created_at';

// Uma página da conversa, em ordem cronológica. Sem cursor, as mais recentes;
// `before` traz as anteriores e `after` só o que chegou depois. Em grupos,
// `hideBlocked` esconde mensagens de quem a pessoa bloqueou.
export async function threadPage(db, conversationId, viewerId, { before = '', after = '', limit = PAGE_LIMIT, hideBlocked = false } = {}) {
  const where = ['m.conversation_id = ?'];
  const params = [conversationId];
  if (before) { where.push('m.id < ?'); params.push(before); }
  if (after) { where.push('m.id > ?'); params.push(after); }
  if (hideBlocked) { where.push(`(m.kind = 'system' OR ${HIDDEN})`); params.push(viewerId); }
  const rows = await db.all(
    `SELECT ${COLUMNS} FROM conversation_messages m WHERE ${where.join(' AND ')} ORDER BY m.id ${after ? 'ASC' : 'DESC'} LIMIT ?`,
    [...params, limit + 1],
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: after ? page : page.reverse(), hasMore };
}

// Mensagens citadas que ficaram fora da página e o resumo das reações.
export async function pageExtras(db, conversationId, viewerId, rows, { hideBlocked = false } = {}) {
  const quoted = new Map(rows.map((row) => [row.id, row]));
  const missing = [...new Set(rows.map((row) => row.reply_to).filter((id) => id && !quoted.has(id)))];
  const [older, reactions] = await Promise.all([
    missing.length
      ? db.all(
        `SELECT ${COLUMNS} FROM conversation_messages m
          WHERE m.conversation_id = ? AND m.id IN (${missing.map(() => '?').join(', ')})${hideBlocked ? ` AND ${HIDDEN}` : ''}`,
        [conversationId, ...missing, ...(hideBlocked ? [viewerId] : [])],
      )
      : [],
    reactionSummaries(db, conversationId, viewerId, rows),
  ]);
  for (const row of older) quoted.set(row.id, row);
  return { quoted, reactions };
}

// Resumo das reações de uma página numa consulta por faixa: Map(id → [{ emoji, count, mine }]).
export async function reactionSummaries(db, conversationId, viewerId, rows) {
  const map = new Map();
  if (!rows.length) return map;
  const found = await db.all(
    `SELECT message_id, emoji, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM conversation_reactions
      WHERE conversation_id = ? AND message_id >= ? AND message_id <= ?
      GROUP BY message_id, emoji ORDER BY message_id, MIN(created_at), emoji`,
    [viewerId, conversationId, rows[0].id, rows.at(-1).id],
  );
  for (const row of found) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push({ emoji: row.emoji, count: Number(row.n), mine: Number(row.mine) > 0 });
  }
  return map;
}

export async function findMessage(db, conversationId, messageIdValue, { viewerId = '', hideBlocked = false, textOnly = false } = {}) {
  if (!conversationId || !ID.test(String(messageIdValue || ''))) return null;
  return db.first(
    `SELECT ${COLUMNS} FROM conversation_messages m
      WHERE m.conversation_id = ? AND m.id = ?${textOnly ? " AND m.kind = 'text'" : ''}${hideBlocked ? ` AND ${HIDDEN}` : ''}`,
    [conversationId, messageIdValue, ...(hideBlocked ? [viewerId] : [])],
  );
}

// Envio repetido (mesmo `clientId` de quem envia, há pouco): a mensagem já gravada.
export async function findResent(db, conversationId, senderId, clientId, now) {
  if (!conversationId || !clientId) return null;
  return db.first(
    `SELECT ${COLUMNS} FROM conversation_messages m
      WHERE m.conversation_id = ? AND m.id > ? AND m.sender_id = ? AND substr(m.id, 15) = ?`,
    [conversationId, stamp(now - RESEND_WINDOW_MS), senderId, clientId],
  );
}

// Instrução de gravação de uma mensagem, para entrar num batch. `conversation`
// é { id } ou { pairKey } (conversa direta que pode estar sendo criada no mesmo batch).
export function insertMessage(conversation, { id, senderId, kind = 'text', body, reference = null, gif = null, replyTo = null, now }) {
  const values = [id, senderId, kind, body, reference ? JSON.stringify(reference) : null, gif, replyTo, iso(now)];
  if (conversation.id) {
    return [
      'INSERT INTO conversation_messages (conversation_id, id, sender_id, kind, body, reference, gif_url, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [conversation.id, ...values],
    ];
  }
  return [
    `INSERT INTO conversation_messages (conversation_id, id, sender_id, kind, body, reference, gif_url, reply_to, created_at)
     SELECT id, ?, ?, ?, ?, ?, ?, ?, ? FROM conversations WHERE pair_key = ?`,
    [...values, conversation.pairKey],
  ];
}

// Instruções que criam a conversa direta e as duas pessoas, se ainda não existem.
export function ensureDirect(a, b, now) {
  const key = pairKey(a, b);
  const at = iso(now);
  const member = (userId) => [
    'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) SELECT id, ?, ? FROM conversations WHERE pair_key = ?',
    [userId, at, key],
  ];
  return [
    ["INSERT OR IGNORE INTO conversations (id, kind, pair_key, created_at) VALUES (?, 'direct', ?, ?)", [crypto.randomUUID(), key, at]],
    member(a),
    member(b),
  ];
}

// Marca como lida só quando há mensagem de outra pessoa depois da marca atual,
// para abrir uma conversa em dia não custar uma gravação.
// `conversation` é { id } ou { pairKey } (conversa direta).
export async function markRead(db, conversation, userId, now) {
  return db.run(
    `UPDATE conversation_members SET last_read_id = ?, last_read_at = ?
      WHERE conversation_id = ${conversation.id ? '?' : '(SELECT id FROM conversations WHERE pair_key = ?)'} AND user_id = ?
        AND EXISTS (SELECT 1 FROM conversation_messages m
                     WHERE m.conversation_id = conversation_members.conversation_id
                       AND m.id > conversation_members.last_read_id AND m.sender_id <> conversation_members.user_id)`,
    [readCursor(now), iso(now), conversation.id || conversation.pairKey, userId],
  );
}

export async function setMuted(db, conversationId, userId, muted) {
  if (typeof muted !== 'boolean') throw invalid('Escolha se quer silenciar a conversa.', 'invalid_preference');
  await db.run('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?', [muted ? 1 : 0, conversationId, userId]);
  return { muted };
}

export function emojiOf(value) {
  const emoji = value || DEFAULT_REACTION;
  if (!isAllowedEmoji(emoji)) throw invalid('Escolha um emoji da lista.', 'invalid_emoji');
  return emoji;
}

export async function setReaction(db, conversationId, userId, messageIdValue, emoji, on, now = Date.now()) {
  const chosen = emojiOf(emoji);
  const changed = on
    ? await db.run(
      'INSERT OR IGNORE INTO conversation_reactions (conversation_id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)',
      [conversationId, messageIdValue, userId, chosen, iso(now)],
    )
    : await db.run(
      'DELETE FROM conversation_reactions WHERE conversation_id = ? AND message_id = ? AND user_id = ? AND emoji = ?',
      [conversationId, messageIdValue, userId, chosen],
    );
  return { reacted: on, emoji: chosen, messageId: messageIdValue, changed: changed > 0 };
}

// Não lidas de todas as conversas (diretas e grupos) e a preferência de aviso,
// numa consulta. Conversa silenciada e remetente bloqueado não contam.
// `kind` ('direct' ou 'group') restringe a contagem a um tipo de conversa.
export async function unreadTotal(db, userId, kind = '') {
  const row = await db.first(
    `SELECT (SELECT COUNT(*) FROM conversation_members p
               ${kind ? 'JOIN conversations c ON c.id = p.conversation_id AND c.kind = ?' : ''}
               JOIN conversation_messages m ON m.conversation_id = p.conversation_id AND m.id > p.last_read_id
              WHERE p.user_id = ? AND p.muted = 0 AND m.kind = 'text' AND m.sender_id <> p.user_id AND ${HIDDEN}) AS total,
            (SELECT notifications FROM message_preferences WHERE user_id = ?) AS notifications`,
    [...(kind ? [kind] : []), userId, userId, userId],
  );
  return { unread: Number(row?.total || 0), notifications: row?.notifications === null || row?.notifications === undefined ? true : Number(row.notifications) !== 0 };
}
