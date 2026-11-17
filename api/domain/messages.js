// Mensagens diretas entre amizades aceitas.
//
// Regras de produto:
// - só existe conversa entre pessoas com amizade registrada nos dois sentidos;
// - bloquear interrompe novas mensagens nos dois sentidos, mas preserva o
//   histórico; desbloquear reabre a conversa;
// - mensagens, referências e notificações não geram XP;
// - referências compartilhadas carregam apenas tipo, id e título, nunca o
//   conteúdo privado do material.
//
// O armazenamento é o modelo comum de conversas (conversations.js): a conversa
// direta é a de `pair_key` igual aos dois ids em ordem, criada no primeiro envio.

import { sanitizeProfileImage } from '../../public/domain.js';
import { AppError } from '../errors.js';
import {
  clientIdOf, ensureDirect, findMessage, findResent, insertMessage, markRead, messageId, pageExtras, pairKey, readCursor, setMuted,
  setReaction, threadPage, unreadTotal,
} from './conversations.js';
import { gifOf, replyIdOf, replyOf, replyPreview } from './message-extras.js';

export const MAX_MESSAGE_LENGTH = 4000;
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

// `friendId` é a outra pessoa da conversa; `readAt` só existe em mensagem de
// quem pede, quando a outra pessoa já leu até ela.
function serializeMessage(row, userId, friendId, { replyTo = null, reactions = [], readAt = null } = {}) {
  const fromMe = row.sender_id === userId;
  return {
    id: row.id,
    fromMe,
    senderId: row.sender_id,
    recipientId: fromMe ? friendId : userId,
    body: row.body,
    reference: serializeReference(row.reference),
    gif: row.gif_url || null,
    replyTo,
    reactions,
    at: row.created_at,
    readAt: fromMe ? readAt : null,
  };
}

const BLOCKED_BY_ME = 'EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = ? AND b.blocked_id = ?)';

// Amizade, bloqueios, a conversa e os nomes numa consulta.
async function directContext(db, userId, friendId) {
  if (!userId || !friendId || userId === friendId || !cleanId(friendId)) {
    throw new MessagesError('Escolha uma amizade para conversar.', 'invalid_contact', 400);
  }
  const row = await db.first(
    `SELECT EXISTS (SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?) AS linked,
            ${BLOCKED_BY_ME} AS blocked_by_me, ${BLOCKED_BY_ME} AS blocked_me,
            (SELECT id FROM conversations WHERE pair_key = ?) AS conversation_id,
            (SELECT p.muted FROM conversation_members p JOIN conversations c ON c.id = p.conversation_id
              WHERE c.pair_key = ? AND p.user_id = ?) AS friend_muted,
            u.name AS my_name, json_extract(d.data, '$.profile.avatar') AS my_avatar,
            (SELECT handle FROM user_handles h WHERE h.user_id = u.id) AS my_handle,
            (SELECT name FROM users WHERE id = ?) AS friend_name
       FROM users u LEFT JOIN account_documents d ON d.user_id = u.id
      WHERE u.id = ?`,
    [userId, friendId, userId, friendId, friendId, userId, pairKey(userId, friendId), pairKey(userId, friendId), friendId, friendId, userId],
  );
  if (!row?.linked) {
    throw new MessagesError('Mensagens diretas existem apenas entre amizades aceitas.', 'not_friends', 403);
  }
  return {
    conversationId: row.conversation_id || '',
    blockedByMe: Boolean(row.blocked_by_me),
    blockedMe: Boolean(row.blocked_me),
    friendMuted: Boolean(row.friend_muted),
    names: new Map([[userId, row.my_name || 'Você'], [friendId, row.friend_name || 'Alguém']]),
    me: { id: userId, name: row.my_name || '', handle: row.my_handle || null, avatar: sanitizeProfileImage(row.my_avatar) },
  };
}

function assertCanMessage(blocks) {
  if (blocks.blockedByMe) throw new MessagesError('Você bloqueou esta pessoa. Desbloqueie para enviar mensagens.', 'blocked_by_me', 403);
  if (blocks.blockedMe) throw new MessagesError('Esta pessoa não está aceitando mensagens suas agora.', 'blocked_by_them', 403);
}

// Uma consulta para a lista inteira. A última mensagem e as não lidas de cada
// conversa saem do índice (conversa, id), sem percorrer o histórico.
export async function listConversations(db, userId) {
  if (!userId) throw new MessagesError('Entre na sua conta para ver suas mensagens.', 'unauthenticated', 401);
  const friends = await db.all(
    `SELECT u.id, u.name, f.created_at AS since, json_extract(d.data, '$.profile.avatar') AS avatar,
            (SELECT json_object('id', m.id, 'sender', m.sender_id, 'body', m.body, 'gif', m.gif_url, 'reference', m.reference, 'at', m.created_at)
               FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last,
            (SELECT COUNT(*) FROM conversation_messages m
              WHERE m.conversation_id = c.id AND m.id > COALESCE(p.last_read_id, '') AND m.sender_id <> f.user_id) AS unread,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.user_id AND b.blocked_id = f.friend_id) AS blocked_by_me,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.friend_id AND b.blocked_id = f.user_id) AS blocked_me,
            COALESCE(p.muted, 0) AS muted,
            (SELECT handle FROM user_handles h WHERE h.user_id = u.id) AS handle
       FROM friendships f JOIN users u ON u.id = f.friend_id
       LEFT JOIN account_documents d ON d.user_id = u.id
       LEFT JOIN conversations c ON c.pair_key = CASE WHEN f.user_id < f.friend_id THEN f.user_id || '|' || f.friend_id ELSE f.friend_id || '|' || f.user_id END
       LEFT JOIN conversation_members p ON p.conversation_id = c.id AND p.user_id = f.user_id
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

// Cabeçalho da conversa numa consulta e uma página de mensagens em outra.
// `page` é { before, after, limit }: sem cursor, as mais recentes.
export async function getThread(db, userId, friendId, page = {}) {
  if (!userId || !friendId || userId === friendId || !cleanId(friendId)) {
    throw new MessagesError('Escolha uma amizade para conversar.', 'invalid_contact', 400);
  }
  const friend = await db.first(
    `SELECT u.id, u.name, json_extract(d.data, '$.profile.avatar') AS avatar,
            (SELECT handle FROM user_handles h WHERE h.user_id = u.id) AS handle,
            (SELECT name FROM users WHERE id = f.user_id) AS my_name,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.user_id AND b.blocked_id = f.friend_id) AS blocked_by_me,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = f.friend_id AND b.blocked_id = f.user_id) AS blocked_me,
            c.id AS conversation_id, COALESCE(me.muted, 0) AS muted,
            other.last_read_id AS other_read_id, other.last_read_at AS other_read_at
       FROM friendships f JOIN users u ON u.id = f.friend_id
       LEFT JOIN account_documents d ON d.user_id = u.id
       LEFT JOIN conversations c ON c.pair_key = ?
       LEFT JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = f.user_id
       LEFT JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id = f.friend_id
      WHERE f.user_id = ? AND f.friend_id = ?`,
    [pairKey(userId, friendId), userId, friendId],
  );
  if (!friend) {
    throw new MessagesError('Mensagens diretas existem apenas entre amizades aceitas.', 'not_friends', 403);
  }
  const { rows, hasMore } = friend.conversation_id
    ? await threadPage(db, friend.conversation_id, userId, page)
    : { rows: [], hasMore: false };
  const { quoted, reactions } = rows.length
    ? await pageExtras(db, friend.conversation_id, userId, rows)
    : { quoted: new Map(), reactions: new Map() };
  const names = new Map([[userId, friend.my_name || 'Você'], [friend.id, friend.name]]);
  const otherReadId = friend.other_read_id || '';
  const blockedByMe = Boolean(friend.blocked_by_me);
  const blockedMe = Boolean(friend.blocked_me);
  return {
    friend: { id: friend.id, name: friend.name, handle: friend.handle || null, avatar: sanitizeProfileImage(friend.avatar) },
    messages: rows.map((row) => serializeMessage(row, userId, friend.id, {
      replyTo: replyOf(row, quoted, names),
      reactions: reactions.get(row.id) || [],
      readAt: row.id <= otherReadId ? friend.other_read_at || row.created_at : null,
    })),
    hasMore,
    readUpTo: otherReadId,
    blockedByMe,
    blockedMe,
    muted: Boolean(friend.muted),
    canMessage: !blockedByMe && !blockedMe,
  };
}

// Devolve a mensagem para quem enviou e, em `deliver`, o que vai pelo canal de
// tempo real para a outra pessoa. Repetir o envio com o mesmo `clientId` devolve
// a mensagem já gravada (`duplicate`), sem gravar nem avisar de novo.
export async function sendMessage(db, userId, friendId, { body, reference, replyToId, gifUrl, clientId } = {}, now = Date.now()) {
  const context = await directContext(db, userId, friendId);
  assertCanMessage(context);
  const text = cleanBody(body);
  const ref = cleanReference(reference);
  const gif = gifOf(gifUrl);
  const replyId = replyIdOf(replyToId);
  const sendId = clientIdOf(clientId);
  if (!text && !ref && !gif) throw new MessagesError('Escreva uma mensagem ou escolha um material.', 'empty_message', 400);
  const [quoted, resent] = await Promise.all([
    replyId ? findMessage(db, context.conversationId, replyId) : null,
    findResent(db, context.conversationId, userId, sendId, now),
  ]);
  if (replyId && !quoted) throw new MessagesError('Mensagem não encontrada nesta conversa.', 'message_not_found', 404);
  if (resent) {
    const known = resent.reply_to ? await findMessage(db, context.conversationId, resent.reply_to) : null;
    return { message: serializeMessage(resent, userId, friendId, { replyTo: replyPreview(known, context.names) }), duplicate: true, deliver: null };
  }
  const row = {
    id: messageId(now, sendId), sender_id: userId, body: text, reference: ref ? JSON.stringify(ref) : null,
    gif_url: gif, reply_to: quoted?.id || null, created_at: iso(now),
  };
  await db.batch([
    ...(context.conversationId ? [] : ensureDirect(userId, friendId, now)),
    insertMessage(context.conversationId ? { id: context.conversationId } : { pairKey: pairKey(userId, friendId) }, {
      id: row.id, senderId: userId, body: text, reference: ref, gif, replyTo: row.reply_to, now,
    }),
  ]);
  const replyTo = replyPreview(quoted, context.names);
  return {
    message: serializeMessage(row, userId, friendId, { replyTo }),
    duplicate: false,
    // Para quem recebe, a conversa é identificada por quem enviou.
    deliver: { to: friendId, muted: context.friendMuted, conversation: { kind: 'direct', id: userId }, message: serializeMessage(row, friendId, userId, { replyTo }), sender: context.me },
  };
}

// Reagir exige a conversa aberta (amizade e sem bloqueio), como escrever.
export async function reactToDirectMessage(db, userId, friendId, messageIdValue, emoji, on, now = Date.now()) {
  const context = await directContext(db, userId, friendId);
  if (on) assertCanMessage(context);
  const row = await findMessage(db, context.conversationId, String(messageIdValue || ''));
  if (!row) throw new MessagesError('Mensagem não encontrada nesta conversa.', 'message_not_found', 404);
  return setReaction(db, context.conversationId, userId, row.id, emoji, on, now);
}

export async function muteDirect(db, userId, friendId, muted, now = Date.now()) {
  const context = await directContext(db, userId, friendId);
  if (typeof muted !== 'boolean') throw new MessagesError('Escolha se quer silenciar a conversa.', 'invalid_preference', 400);
  let { conversationId } = context;
  if (!conversationId) {
    await db.batch(ensureDirect(userId, friendId, now));
    conversationId = (await db.first('SELECT id FROM conversations WHERE pair_key = ?', [pairKey(userId, friendId)]))?.id;
  }
  return setMuted(db, conversationId, userId, muted);
}

// `read` diz se havia algo novo para marcar (só então há gravação).
export async function markThreadRead(db, userId, friendId, now = Date.now()) {
  if (!userId || !friendId || userId === friendId || !cleanId(friendId)) {
    throw new MessagesError('Escolha uma amizade para conversar.', 'invalid_contact', 400);
  }
  const read = await markRead(db, { pairKey: pairKey(userId, friendId) }, userId, now);
  if (!read) await directContext(db, userId, friendId);
  return { read, readUpTo: readCursor(now), at: iso(now) };
}

// Não lidas das conversas diretas e a preferência de aviso.
export async function unreadSummary(db, userId) {
  if (!userId) throw new MessagesError('Entre na sua conta para ver suas notificações.', 'unauthenticated', 401);
  return unreadTotal(db, userId, 'direct');
}

// Sem linha gravada, vale o padrão (avisos ligados); ler não grava.
export async function messagePreferences(db, userId) {
  const row = await db.first('SELECT notifications FROM message_preferences WHERE user_id = ?', [userId]);
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
