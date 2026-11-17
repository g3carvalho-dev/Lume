// Grupos de conversa entre amigos.
//
// Regras de produto:
// - quem cria o grupo só adiciona as próprias amizades; o grupo tem de 3 a 20
//   pessoas e quem criou é a dona do grupo (renomeia, adiciona e remove);
// - ninguém é adicionado se houver bloqueio entre essa pessoa e quem adiciona;
// - mensagens de quem a pessoa bloqueou ficam ocultas só para ela;
// - quem sai deixa de ver o grupo; se a dona sai, o grupo passa à pessoa mais
//   antiga que ficou, e sem ninguém o grupo é apagado;
// - mensagens de grupo não geram XP.
//
// O armazenamento é o modelo comum de conversas (conversations.js): o grupo é a
// conversa de `kind = 'group'` e o id do grupo é o id da conversa.
import { sanitizeProfileImage } from '../../public/domain.js';
import { GROUP_MAX_MEMBERS, GROUP_MIN_OTHERS, GROUP_NAME_LIMIT } from '../../public/report-domain.js';
import { MessagesError, cleanBody, cleanReference, previewText, serializeReference } from './messages.js';
import {
  clientIdOf, findMessage, findResent, insertMessage, markRead, messageId, pageExtras, readCursor, setMuted, setReaction, threadPage,
  unreadTotal,
} from './conversations.js';
import { gifOf, replyIdOf, replyOf, replyPreview } from './message-extras.js';

const iso = (now) => new Date(now).toISOString();
const marks = (list) => list.map(() => '?').join(', ');

function groupId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new MessagesError('Grupo inválido.', 'invalid_group', 400);
  return value;
}

function groupName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new MessagesError('Dê um nome ao grupo.', 'invalid_group_name', 400);
  if (name.length > GROUP_NAME_LIMIT) throw new MessagesError(`O nome do grupo pode ter até ${GROUP_NAME_LIMIT} caracteres.`, 'invalid_group_name', 400);
  return name;
}

const HIDDEN = (sender) => `NOT EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = ? AND b.blocked_id = ${sender})`;
const notFound = () => new MessagesError('Grupo não encontrado.', 'group_not_found', 404);

async function membership(db, userId, id) {
  const row = await db.first(
    `SELECT c.id, c.name, c.owner_id, c.created_at, p.muted FROM conversations c
       JOIN conversation_members p ON p.conversation_id = c.id AND p.user_id = ?
      WHERE c.id = ? AND c.kind = 'group'`,
    [userId, groupId(id)],
  );
  if (!row) throw notFound();
  return row;
}

// Pessoas do grupo, da mais antiga à mais nova. Com `senderId`, `hidden` diz
// quem bloqueou essa pessoa (e por isso não vê as mensagens dela).
async function groupPeople(db, id, senderId = '') {
  return db.all(
    `SELECT u.id, u.name, json_extract(d.data, '$.profile.avatar') AS avatar, p.joined_at, p.muted,
            (SELECT handle FROM user_handles h WHERE h.user_id = u.id) AS handle,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = u.id AND b.blocked_id = ?) AS hidden
       FROM conversation_members p
       JOIN conversations c ON c.id = p.conversation_id AND c.kind = 'group'
       JOIN users u ON u.id = p.user_id LEFT JOIN account_documents d ON d.user_id = u.id
      WHERE p.conversation_id = ? ORDER BY p.joined_at, u.name COLLATE NOCASE, u.id`,
    [senderId, id],
  );
}

const person = (row) => ({ id: row.id, name: row.name, handle: row.handle || null, avatar: sanitizeProfileImage(row.avatar) });

function systemMessage(id, actorId, body, now) {
  return insertMessage({ id }, { id: messageId(now), senderId: actorId, kind: 'system', body, now });
}

// Só amizades de quem adiciona, sem bloqueio nos dois sentidos. Uma consulta
// para a lista inteira; devolve o nome de quem adiciona e o das pessoas.
async function assertAddable(db, ownerId, ids) {
  const rows = await db.all(
    `SELECT u.id, u.name,
            EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = ? AND f.friend_id = u.id) AS linked,
            EXISTS (SELECT 1 FROM contact_blocks b WHERE (b.user_id = ? AND b.blocked_id = u.id) OR (b.user_id = u.id AND b.blocked_id = ?)) AS blocked
       FROM users u WHERE u.id IN (${marks([ownerId, ...ids])})`,
    [ownerId, ownerId, ownerId, ownerId, ...ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    if (!byId.get(id)?.linked) throw new MessagesError('Só é possível adicionar pessoas da sua lista de amigos.', 'not_friends', 403);
  }
  for (const id of ids) {
    if (byId.get(id).blocked) throw new MessagesError('Não é possível adicionar uma pessoa bloqueada ou que bloqueou você.', 'blocked', 403);
  }
  return new Map(rows.map((row) => [row.id, row.name]));
}

function uniqueIds(value, self) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(item) && item !== self))];
}

const addMember = (id, userId, now) => [
  'INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_id, last_read_at) VALUES (?, ?, ?, ?, ?)',
  [id, userId, iso(now), readCursor(now), iso(now)],
];

export async function createGroup(db, userId, { name, memberIds } = {}, now = Date.now()) {
  const title = groupName(name);
  const others = uniqueIds(memberIds, userId);
  if (others.length < GROUP_MIN_OTHERS) throw new MessagesError(`Escolha pelo menos ${GROUP_MIN_OTHERS} amigos para o grupo.`, 'group_too_small', 400);
  if (others.length + 1 > GROUP_MAX_MEMBERS) throw new MessagesError(`Um grupo pode ter até ${GROUP_MAX_MEMBERS} pessoas.`, 'group_too_large', 400);
  const names = await assertAddable(db, userId, others);
  const id = crypto.randomUUID();
  await db.batch([
    ["INSERT INTO conversations (id, kind, name, owner_id, created_at) VALUES (?, 'group', ?, ?, ?)", [id, title, userId, iso(now)]],
    ...[userId, ...others].map((member) => addMember(id, member, now)),
    systemMessage(id, userId, `${names.get(userId) || 'Alguém'} criou o grupo.`, now),
  ]);
  return { id, memberIds: others };
}

export async function listGroups(db, userId) {
  const rows = await db.all(
    `SELECT c.id, c.name, c.owner_id, p.muted,
            (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS members,
            (SELECT json_object('id', m.id, 'sender', m.sender_id, 'name', u.name, 'body', m.body, 'gif', m.gif_url, 'reference', m.reference, 'kind', m.kind, 'at', m.created_at)
               FROM conversation_messages m JOIN users u ON u.id = m.sender_id
              WHERE m.conversation_id = c.id AND (m.kind = 'system' OR ${HIDDEN('m.sender_id')})
              ORDER BY m.id DESC LIMIT 1) AS last,
            (SELECT COUNT(*) FROM conversation_messages m
              WHERE m.conversation_id = c.id AND m.id > p.last_read_id AND m.kind = 'text' AND m.sender_id <> p.user_id AND ${HIDDEN('m.sender_id')}) AS unread
       FROM conversation_members p JOIN conversations c ON c.id = p.conversation_id AND c.kind = 'group'
      WHERE p.user_id = ?`,
    [userId, userId, userId],
  );
  return rows.map((row) => {
    const last = row.last ? JSON.parse(row.last) : null;
    const preview = last ? (last.kind === 'system' ? last.body : `${last.sender === userId ? 'Você' : last.name.split(' ')[0]}: ${previewText(last.body, { gif: last.gif, reference: last.reference })}`) : '';
    return {
      id: row.id,
      name: row.name,
      members: Number(row.members),
      isOwner: row.owner_id === userId,
      lastMessage: last ? { id: last.id, fromMe: last.sender === userId, preview: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview, at: last.at } : null,
      unread: Number(row.unread || 0),
      muted: Boolean(row.muted),
    };
  }).sort((left, right) => (right.lastMessage?.at || '').localeCompare(left.lastMessage?.at || '') || left.name.localeCompare(right.name, 'pt-BR'));
}

export async function unreadGroupMessages(db, userId) {
  return (await unreadTotal(db, userId, 'group')).unread;
}

function serializeGroupMessage(row, userId, sender, { replyTo = null, reactions = [] } = {}) {
  return {
    id: row.id,
    kind: row.kind || 'text',
    fromMe: row.sender_id === userId,
    senderId: row.sender_id,
    sender: sender ? person(sender) : { id: row.sender_id, name: 'Ex-participante', avatar: '' },
    body: row.body,
    reference: serializeReference(row.reference),
    gif: row.gif_url || null,
    replyTo,
    reactions,
    at: row.created_at,
  };
}

// `page` é { before, after, limit }: sem cursor, as mensagens mais recentes.
export async function getGroupThread(db, userId, id, page = {}) {
  const group = await membership(db, userId, id);
  const [members, { rows, hasMore }] = await Promise.all([
    groupPeople(db, group.id),
    threadPage(db, group.id, userId, { ...page, hideBlocked: true }),
  ]);
  const { quoted, reactions } = await pageExtras(db, group.id, userId, rows, { hideBlocked: true });
  const byId = new Map(members.map((member) => [member.id, member]));
  const names = new Map(members.map((member) => [member.id, member.name]));
  const gone = [...new Set([...quoted.values()].map((row) => row.sender_id).filter((sender) => !byId.has(sender)))];
  if (gone.length) {
    for (const row of await db.all(`SELECT id, name FROM users WHERE id IN (${marks(gone)})`, gone)) names.set(row.id, row.name);
  }
  return {
    group: { id: group.id, name: group.name, ownerId: group.owner_id, isOwner: group.owner_id === userId, createdAt: group.created_at },
    members: members.map((member) => ({ ...person(member), isOwner: member.id === group.owner_id, isMe: member.id === userId })),
    messages: rows.map((row) => serializeGroupMessage(row, userId, byId.get(row.sender_id), {
      replyTo: replyOf(row, quoted, names),
      reactions: reactions.get(row.id) || [],
    })),
    hasMore,
    muted: Boolean(group.muted),
    canMessage: true,
  };
}

export async function groupMemberIds(db, id) {
  return (await db.all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', [id])).map((row) => row.user_id);
}

async function groupMessage(db, userId, id, messageIdValue) {
  const row = await findMessage(db, id, String(messageIdValue || ''), { viewerId: userId, hideBlocked: true, textOnly: true });
  if (!row) throw new MessagesError('Mensagem não encontrada neste grupo.', 'message_not_found', 404);
  return row;
}

// Devolve a mensagem para quem enviou e, em `deliver`, o que vai pelo canal de
// tempo real: quem bloqueou quem enviou não recebe. Repetir o envio com o mesmo
// `clientId` devolve a mensagem já gravada (`duplicate`).
export async function sendGroupMessage(db, userId, id, { body, reference, replyToId, gifUrl, clientId } = {}, now = Date.now()) {
  const people = await groupPeople(db, groupId(id), userId);
  const me = people.find((member) => member.id === userId);
  if (!me) throw notFound();
  const text = cleanBody(body);
  const ref = cleanReference(reference);
  const gif = gifOf(gifUrl);
  const replyId = replyIdOf(replyToId);
  const sendId = clientIdOf(clientId);
  if (!text && !ref && !gif) throw new MessagesError('Escreva uma mensagem ou escolha um material.', 'empty_message', 400);
  const [quoted, resent] = await Promise.all([
    replyId ? groupMessage(db, userId, id, replyId) : null,
    findResent(db, id, userId, sendId, now),
  ]);
  const names = new Map(people.map((member) => [member.id, member.name]));
  const memberIds = people.map((member) => member.id);
  if (resent) return { message: serializeGroupMessage(resent, userId, me), memberIds, duplicate: true, deliver: null };
  if (quoted && !names.has(quoted.sender_id)) {
    names.set(quoted.sender_id, (await db.first('SELECT name FROM users WHERE id = ?', [quoted.sender_id]))?.name || 'Alguém');
  }
  const row = {
    id: messageId(now, sendId), sender_id: userId, kind: 'text', body: text, reference: ref ? JSON.stringify(ref) : null,
    gif_url: gif, reply_to: quoted?.id || null, created_at: iso(now),
  };
  await db.batch([insertMessage({ id }, { id: row.id, senderId: userId, body: text, reference: ref, gif, replyTo: row.reply_to, now })]);
  const replyTo = replyPreview(quoted, names);
  return {
    message: serializeGroupMessage(row, userId, me, { replyTo }),
    memberIds,
    duplicate: false,
    deliver: {
      to: people.filter((member) => member.id !== userId && !member.hidden).map((member) => ({ id: member.id, muted: Boolean(member.muted) })),
      conversation: { kind: 'group', id },
      message: { ...serializeGroupMessage(row, '', me, { replyTo }), fromMe: false },
    },
  };
}

export async function reactToGroupMessage(db, userId, id, messageIdValue, emoji, on, now = Date.now()) {
  const group = await membership(db, userId, id);
  const row = await groupMessage(db, userId, group.id, messageIdValue);
  const reacted = await setReaction(db, group.id, userId, row.id, emoji, on, now);
  return { ...reacted, memberIds: reacted.changed ? await groupMemberIds(db, group.id) : [] };
}

export async function muteGroup(db, userId, id, muted) {
  const group = await membership(db, userId, id);
  return setMuted(db, group.id, userId, muted);
}

// `read` diz se havia algo novo para marcar (só então há gravação).
export async function markGroupRead(db, userId, id, now = Date.now()) {
  const read = await markRead(db, { id: groupId(id) }, userId, now);
  if (!read) await membership(db, userId, id);
  return { read };
}

export async function renameGroup(db, userId, id, name, now = Date.now()) {
  const group = await membership(db, userId, id);
  if (group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode mudar o nome.', 'not_owner', 403);
  const title = groupName(name);
  const people = await groupPeople(db, group.id);
  const mine = people.find((member) => member.id === userId)?.name || 'Alguém';
  await db.batch([
    ['UPDATE conversations SET name = ? WHERE id = ?', [title, group.id]],
    systemMessage(group.id, userId, `${mine} mudou o nome do grupo para “${title}”.`, now),
  ]);
  return { id: group.id, name: title, memberIds: people.map((member) => member.id) };
}

export async function addGroupMembers(db, userId, id, { memberIds } = {}, now = Date.now()) {
  const group = await membership(db, userId, id);
  if (group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode adicionar pessoas.', 'not_owner', 403);
  const current = await groupMemberIds(db, group.id);
  const fresh = uniqueIds(memberIds, userId).filter((member) => !current.includes(member));
  if (!fresh.length) throw new MessagesError('Escolha amigos que ainda não estão no grupo.', 'nobody_to_add', 400);
  if (current.length + fresh.length > GROUP_MAX_MEMBERS) throw new MessagesError(`Um grupo pode ter até ${GROUP_MAX_MEMBERS} pessoas.`, 'group_too_large', 400);
  const names = await assertAddable(db, userId, fresh);
  await db.batch([
    ...fresh.map((member) => addMember(group.id, member, now)),
    systemMessage(group.id, userId, `${names.get(userId) || 'Alguém'} adicionou ${fresh.map((member) => names.get(member)).join(', ')}.`, now),
  ]);
  return { id: group.id, added: fresh, memberIds: [...current, ...fresh] };
}

// A própria pessoa sai; a dona do grupo também pode remover alguém.
export async function removeGroupMember(db, userId, id, targetId, now = Date.now()) {
  const group = await membership(db, userId, id);
  const leaving = targetId === userId;
  if (!leaving && group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode remover pessoas.', 'not_owner', 403);
  const people = await groupPeople(db, group.id);
  const target = people.find((member) => member.id === targetId);
  if (!target) throw new MessagesError('Essa pessoa não está no grupo.', 'not_member', 404);
  const before = people.map((member) => member.id);
  const remaining = people.filter((member) => member.id !== targetId);
  if (!remaining.length) {
    await db.run('DELETE FROM conversations WHERE id = ?', [group.id]);
    return { id: group.id, removed: targetId, deleted: true, memberIds: before };
  }
  const mine = people.find((member) => member.id === userId)?.name || 'Alguém';
  // A lista vem da pessoa mais antiga à mais nova: a primeira que ficou herda o grupo.
  const heir = [...remaining].sort((left, right) => left.joined_at.localeCompare(right.joined_at) || left.id.localeCompare(right.id))[0];
  await db.batch([
    ['DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [group.id, targetId]],
    ...(leaving && group.owner_id === userId ? [['UPDATE conversations SET owner_id = ? WHERE id = ?', [heir.id, group.id]]] : []),
    systemMessage(group.id, userId, leaving ? `${target.name} saiu do grupo.` : `${mine} removeu ${target.name}.`, now),
  ]);
  return { id: group.id, removed: targetId, deleted: false, memberIds: before };
}

export async function deleteGroup(db, userId, id) {
  const group = await membership(db, userId, id);
  if (group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode apagá-lo.', 'not_owner', 403);
  const memberIds = await groupMemberIds(db, group.id);
  await db.run('DELETE FROM conversations WHERE id = ?', [group.id]);
  return { deleted: true, memberIds };
}
