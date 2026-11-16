// Mensagens diretas entre amizades aceitas.
//
// Regras de produto:
// - só existe conversa entre pessoas com amizade registrada nos dois sentidos;
// - bloquear interrompe novas mensagens nos dois sentidos, mas preserva o
//   histórico; desbloquear reabre a conversa;
// - mensagens, referências e notificações não geram XP;
// - referências compartilhadas carregam apenas tipo, id e título, nunca o
//   conteúdo privado do material.

import { sanitizeProfileImage } from '../../public/domain.js';
import { AppError } from '../errors.js';
import { gifOf, isMuted, reactionSummaries, replyIdOf, replyPreview, setMuted, setReaction } from './message-extras.js';

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGES_PER_THREAD = 200;
export const MAX_REFERENCE_TITLE = 160;
export const MESSAGE_WINDOW_LIMIT = 120;

export class MessagesError extends AppError {
  constructor(message, code = 'messages_error', status = 400) {
    super(message, code, status);
    this.name = 'MessagesError';
  }
}

function iso(now) {
  return new Date(now).toISOString();
}

function cleanId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : '';
}

export function cleanBody(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function cleanReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = ['course', 'lesson', 'article', 'book', 'exercise', 'project', 'slide'].includes(value.type) ? value.type : 'course';
  const id = cleanId(value.id);
  const title = String(value.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_REFERENCE_TITLE);
  if (!id || !title) return null;
  return { type, id, title };
}

export function serializeReference(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return cleanReference(parsed);
  } catch {
    return null;
  }
}

// Trecho exibido na lista de conversas: texto, ou o tipo do que foi enviado.
export function previewText(body, { gif = null, reference = null } = {}) {
  const text = String(body || '');
  if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  if (gif) return 'GIF';
  if (reference) return 'Material compartilhado';
  return '';
}

function serializeMessage(row, userId, { replyTo = null, reactions = [] } = {}) {
  return {
    id: row.id,
    fromMe: row.sender_id === userId,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    reference: serializeReference(row.reference),
    gif: row.gif_url || null,
    replyTo,
    reactions,
    at: row.created_at,
    readAt: row.read_at || null,
  };
}

async function assertFriendship(db, userId, friendId) {
  if (!userId || !friendId || userId === friendId) {
    throw new MessagesError('Escolha uma amizade para conversar.', 'invalid_contact', 400);
  }
  const linked = await db.first(
    'SELECT 1 AS linked FROM friendships WHERE user_id = ? AND friend_id = ?',
    [userId, friendId],
  );
  if (!linked) {
    throw new MessagesError('Mensagens diretas existem apenas entre amizades aceitas.', 'not_friends', 403);
  }
}

async function blockState(db, userId, friendId) {
  const mine = await db.first('SELECT 1 AS blocked FROM contact_blocks WHERE user_id = ? AND blocked_id = ?', [userId, friendId]);
  const theirs = await db.first('SELECT 1 AS blocked FROM contact_blocks WHERE user_id = ? AND blocked_id = ?', [friendId, userId]);
  return { blockedByMe: Boolean(mine), blockedMe: Boolean(theirs) };
}

function assertCanMessage(blocks) {
  if (blocks.blockedByMe) throw new MessagesError('Você bloqueou esta pessoa. Desbloqueie para enviar mensagens.', 'blocked_by_me', 403);
  if (blocks.blockedMe) throw new MessagesError('Esta pessoa não está aceitando mensagens suas agora.', 'blocked_by_them', 403);
}

// Uma consulta só para a lista inteira: no D1 cada consulta é uma ida à rede, e a
// versão anterior fazia quatro por amizade, em sequência.
export async function listConversations(db, userId, now = Date.now()) {
  if (!userId) throw new MessagesError('Entre na sua conta para ver suas mensagens.', 'unauthenticated', 401);
  const friends = await db.all(
    `SELECT u.id, u.name, f.created_at AS since, json_extract(d.data, '$.profile.avatar') AS avatar,
            (SELECT json_object('id', m.id, 'sender', m.sender_id, 'body', m.body, 'gif', m.gif_url, 'reference', m.reference, 'at', m.created_at)
               FROM direct_messages m
              WHERE (m.sender_id = f.user_id AND m.recipient_id = f.friend_id) OR (m.sender_id = f.friend_id AND m.recipient_id = f.user_id)
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last,
            (SELECT COUNT(*) FROM direct_messages m
              WHERE m.sender_id = f.friend_id AND m.recipient_id = f.user_id AND m.read_at IS NULL) AS unread,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.user_id AND b.blocked_id = f.friend_id) AS blocked_by_me,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.friend_id AND b.blocked_id = f.user_id) AS blocked_me,
            EXISTS (SELECT 1 FROM conversation_mutes x WHERE x.user_id = f.user_id AND x.scope = 'direct' AND x.target_id = f.friend_id) AS muted,
            (SELECT handle FROM user_handles h WHERE h.user_id = u.id) AS handle
       FROM friendships f JOIN users u ON u.id = f.friend_id
       LEFT JOIN account_documents d ON d.user_id = u.id
      WHERE f.user_id = ?
      ORDER BY u.name COLLATE NOCASE`,
    [userId],
  );
  const rows = friends.map((friend) => {
    const last = friend.last ? JSON.parse(friend.last) : null;
    const blockedByMe = Boolean(friend.blocked_by_me);
    const blockedMe = Boolean(friend.blocked_me);
    return {
      id: friend.id,
      name: friend.name,
      handle: friend.handle || null,
      avatar: sanitizeProfileImage(friend.avatar),
      since: friend.since,
      lastMessage: last ? {
        id: last.id,
        fromMe: last.sender === userId,
        preview: previewText(last.body, { gif: last.gif, reference: last.reference }),
        at: last.at,
      } : null,
      muted: Boolean(friend.muted),
      unread: Number(friend.unread || 0),
      blockedByMe,
      blockedMe,
      canMessage: !blockedByMe && !blockedMe,
    };
  });
  rows.sort((left, right) => {
    const a = left.lastMessage?.at || '';
    const b = right.lastMessage?.at || '';
    if (a !== b) return b.localeCompare(a);
    return left.name.localeCompare(right.name, 'pt-BR');
  });
  return { conversations: rows, count: rows.length };
}

// Amizade, dados da pessoa e bloqueios numa consulta, e as mensagens em outra.
export async function getThread(db, userId, friendId) {
  if (!userId || !friendId || userId === friendId) {
    throw new MessagesError('Escolha uma amizade para conversar.', 'invalid_contact', 400);
  }
  const friend = await db.first(
    `SELECT u.id, u.name, json_extract(d.data, '$.profile.avatar') AS avatar,
            (SELECT handle FROM user_handles h WHERE h.user_id = u.id) AS handle,
            EXISTS (SELECT 1 FROM conversation_mutes x WHERE x.user_id = f.user_id AND x.scope = 'direct' AND x.target_id = f.friend_id) AS muted,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.user_id AND b.blocked_id = f.friend_id) AS blocked_by_me,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.friend_id AND b.blocked_id = f.user_id) AS blocked_me
       FROM friendships f JOIN users u ON u.id = f.friend_id
       LEFT JOIN account_documents d ON d.user_id = u.id
      WHERE f.user_id = ? AND f.friend_id = ?`,
    [userId, friendId],
  );
  if (!friend) {
    throw new MessagesError('Mensagens diretas existem apenas entre amizades aceitas.', 'not_friends', 403);
  }
  const rows = await db.all(
    `SELECT id, sender_id, recipient_id, body, reference, gif_url, reply_to, created_at, read_at
       FROM direct_messages
      WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, friendId, friendId, userId, MAX_MESSAGES_PER_THREAD],
  );
  const blockedByMe = Boolean(friend.blocked_by_me);
  const blockedMe = Boolean(friend.blocked_me);
  const me = await db.first('SELECT name FROM users WHERE id = ?', [userId]);
  const names = new Map([[userId, me?.name || 'Você'], [friend.id, friend.name]]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = [...new Set(rows.map((row) => row.reply_to).filter((id) => id && !byId.has(id)))];
  if (missing.length) {
    const older = await db.all(
      `SELECT id, sender_id, body, reference, gif_url FROM direct_messages
        WHERE id IN (${missing.map(() => '?').join(', ')})
          AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`,
      [...missing, userId, friendId, friendId, userId],
    );
    for (const row of older) byId.set(row.id, row);
  }
  const reactions = await reactionSummaries(db, 'direct', userId, rows.map((row) => row.id));
  return {
    friend: { id: friend.id, name: friend.name, handle: friend.handle || null, avatar: sanitizeProfileImage(friend.avatar) },
    messages: rows.reverse().map((row) => serializeMessage(row, userId, {
      replyTo: row.reply_to ? replyPreview(byId.get(row.reply_to), names) || { id: row.reply_to, senderName: '', preview: 'Mensagem indisponível' } : null,
      reactions: reactions.get(row.id) || [],
    })),
    blockedByMe,
    blockedMe,
    muted: Boolean(friend.muted),
    canMessage: !blockedByMe && !blockedMe,
  };
}

async function directMessage(db, userId, friendId, messageId) {
  const row = await db.first(
    `SELECT id, sender_id, body, reference, gif_url FROM direct_messages
      WHERE id = ? AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`,
    [messageId, userId, friendId, friendId, userId],
  );
  if (!row) throw new MessagesError('Mensagem não encontrada nesta conversa.', 'message_not_found', 404);
  return row;
}

export async function sendMessage(db, userId, friendId, { body, reference, replyToId, gifUrl } = {}, now = Date.now()) {
  await assertFriendship(db, userId, friendId);
  const blocks = await blockState(db, userId, friendId);
  assertCanMessage(blocks);
  const text = cleanBody(body);
  const ref = cleanReference(reference);
  const gif = gifOf(gifUrl);
  const replyId = replyIdOf(replyToId);
  if (!text && !ref && !gif) throw new MessagesError('Escreva uma mensagem ou escolha um material.', 'empty_message', 400);
  const quoted = replyId ? await directMessage(db, userId, friendId, replyId) : null;
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body, reference, gif_url, reply_to, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, userId, friendId, text, ref ? JSON.stringify(ref) : null, gif, quoted?.id || null, iso(now)],
  );
  const row = await db.first('SELECT * FROM direct_messages WHERE id = ?', [id]);
  let replyTo = null;
  if (quoted) {
    const people = await db.all('SELECT id, name FROM users WHERE id IN (?, ?)', [userId, friendId]);
    replyTo = replyPreview(quoted, new Map(people.map((person) => [person.id, person.name])));
  }
  return { message: serializeMessage(row, userId, { replyTo }) };
}

// Reagir exige a conversa aberta (amizade e sem bloqueio), como escrever.
export async function reactToDirectMessage(db, userId, friendId, messageId, emoji, on, now = Date.now()) {
  await assertFriendship(db, userId, friendId);
  if (on) assertCanMessage(await blockState(db, userId, friendId));
  const row = await directMessage(db, userId, friendId, String(messageId || ''));
  return setReaction(db, 'direct', userId, row.id, emoji, on, now);
}

export async function muteDirect(db, userId, friendId, muted, now = Date.now()) {
  await assertFriendship(db, userId, friendId);
  return setMuted(db, userId, 'direct', friendId, muted, now);
}

export async function directMuted(db, userId, friendId) {
  return isMuted(db, userId, 'direct', friendId);
}

export async function markThreadRead(db, userId, friendId, now = Date.now()) {
  await assertFriendship(db, userId, friendId);
  const read = await db.run(
    'UPDATE direct_messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL',
    [iso(now), friendId, userId],
  );
  return { read };
}

export async function unreadSummary(db, userId) {
  if (!userId) throw new MessagesError('Entre na sua conta para ver suas notificações.', 'unauthenticated', 401);
  const row = await db.first(
    `SELECT COUNT(*) AS total FROM direct_messages m
      WHERE m.recipient_id = ? AND m.read_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = ? AND b.blocked_id = m.sender_id)
        AND NOT EXISTS (SELECT 1 FROM conversation_mutes x WHERE x.user_id = ? AND x.scope = 'direct' AND x.target_id = m.sender_id)`,
    [userId, userId, userId],
  );
  const preferences = await messagePreferences(db, userId);
  return { unread: Number(row?.total || 0), notifications: preferences.notifications };
}

export async function messagePreferences(db, userId) {
  let row = await db.first('SELECT notifications FROM message_preferences WHERE user_id = ?', [userId]);
  if (!row) {
    await db.run(
      'INSERT OR IGNORE INTO message_preferences (user_id, notifications, updated_at) VALUES (?, 1, ?)',
      [userId, iso(Date.now())],
    );
    row = await db.first('SELECT notifications FROM message_preferences WHERE user_id = ?', [userId]);
  }
  return { notifications: row ? Number(row.notifications) !== 0 : true };
}

export async function updateMessagePreferences(db, userId, { notifications }, now = Date.now()) {
  if (typeof notifications !== 'boolean') throw new MessagesError('Escolha se quer receber notificações.', 'invalid_preference', 400);
  await db.run(
    `INSERT INTO message_preferences (user_id, notifications, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET notifications = excluded.notifications, updated_at = excluded.updated_at`,
    [userId, notifications ? 1 : 0, iso(now)],
  );
  return { notifications };
}

export async function blockContact(db, userId, friendId, now = Date.now()) {
  if (!userId || !friendId || userId === friendId) throw new MessagesError('Contato inválido.', 'invalid_contact', 400);
  const target = await db.first('SELECT 1 AS found FROM users WHERE id = ?', [friendId]);
  if (!target) throw new MessagesError('Pessoa não encontrada.', 'not_found', 404);
  await db.run(
    'INSERT OR IGNORE INTO contact_blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)',
    [userId, friendId, iso(now)],
  );
  return { blocked: true, blockedId: friendId };
}

export async function unblockContact(db, userId, friendId) {
  if (!userId || !friendId) throw new MessagesError('Contato inválido.', 'invalid_contact', 400);
  await db.run('DELETE FROM contact_blocks WHERE user_id = ? AND blocked_id = ?', [userId, friendId]);
  return { blocked: false, blockedId: friendId };
}

export async function listBlocks(db, userId) {
  const rows = await db.all(
    `SELECT b.blocked_id, u.name, b.created_at FROM contact_blocks b
       JOIN users u ON u.id = b.blocked_id
      WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    [userId],
  );
  return { blocks: rows.map((row) => ({ id: row.blocked_id, name: row.name, since: row.created_at })) };
}
