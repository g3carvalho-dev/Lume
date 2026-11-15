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
import { sanitizeProfileImage } from '../../public/domain.js';
import { GROUP_MAX_MEMBERS, GROUP_MIN_OTHERS, GROUP_NAME_LIMIT } from '../../public/report-domain.js';
import { MAX_MESSAGES_PER_THREAD, MessagesError, cleanBody, cleanReference, serializeReference } from './messages.js';

const iso = (now) => new Date(now).toISOString();

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

async function membership(db, userId, id) {
  const row = await db.first(
    `SELECT g.id, g.name, g.owner_id, g.created_at FROM chat_groups g
       JOIN chat_group_members m ON m.group_id = g.id AND m.user_id = ? WHERE g.id = ?`,
    [userId, groupId(id)],
  );
  if (!row) throw new MessagesError('Grupo não encontrado.', 'group_not_found', 404);
  return row;
}

async function addSystemMessage(db, id, actorId, body, now) {
  await db.run(
    "INSERT INTO chat_group_messages (id, group_id, sender_id, body, reference, kind, created_at) VALUES (?, ?, ?, ?, NULL, 'system', ?)",
    [crypto.randomUUID(), id, actorId, body, iso(now)],
  );
}

async function userName(db, id) {
  return (await db.first('SELECT name FROM users WHERE id = ?', [id]))?.name || 'Alguém';
}

// Só amizades de quem adiciona, sem bloqueio nos dois sentidos.
async function assertAddable(db, ownerId, ids) {
  for (const id of ids) {
    const friend = await db.first('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', [ownerId, id]);
    if (!friend) throw new MessagesError('Só é possível adicionar pessoas da sua lista de amigos.', 'not_friends', 403);
    const blocked = await db.first(
      'SELECT 1 AS ok FROM contact_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
      [ownerId, id, id, ownerId],
    );
    if (blocked) throw new MessagesError('Não é possível adicionar uma pessoa bloqueada ou que bloqueou você.', 'blocked', 403);
  }
}

function uniqueIds(value, self) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(item) && item !== self))];
}

export async function createGroup(db, userId, { name, memberIds } = {}, now = Date.now()) {
  const title = groupName(name);
  const others = uniqueIds(memberIds, userId);
  if (others.length < GROUP_MIN_OTHERS) throw new MessagesError(`Escolha pelo menos ${GROUP_MIN_OTHERS} amigos para o grupo.`, 'group_too_small', 400);
  if (others.length + 1 > GROUP_MAX_MEMBERS) throw new MessagesError(`Um grupo pode ter até ${GROUP_MAX_MEMBERS} pessoas.`, 'group_too_large', 400);
  await assertAddable(db, userId, others);
  const id = crypto.randomUUID();
  const at = iso(now);
  await db.batch([
    ['INSERT INTO chat_groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)', [id, title, userId, at]],
    ...[userId, ...others].map((member) => [
      'INSERT INTO chat_group_members (group_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)',
      [id, member, at, at],
    ]),
  ]);
  await addSystemMessage(db, id, userId, `${await userName(db, userId)} criou o grupo.`, now);
  return { id, memberIds: others };
}

export async function listGroups(db, userId) {
  const rows = await db.all(
    `SELECT g.id, g.name, g.owner_id, m.last_read_at,
            (SELECT COUNT(*) FROM chat_group_members x WHERE x.group_id = g.id) AS members,
            (SELECT json_object('id', c.id, 'sender', c.sender_id, 'name', u.name, 'body', c.body, 'kind', c.kind, 'at', c.created_at)
               FROM chat_group_messages c JOIN users u ON u.id = c.sender_id
              WHERE c.group_id = g.id AND (c.kind = 'system' OR ${HIDDEN('c.sender_id')})
              ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS last,
            (SELECT COUNT(*) FROM chat_group_messages c
              WHERE c.group_id = g.id AND c.kind = 'text' AND c.sender_id <> ? AND c.created_at > m.last_read_at AND ${HIDDEN('c.sender_id')}) AS unread
       FROM chat_groups g JOIN chat_group_members m ON m.group_id = g.id AND m.user_id = ?`,
    [userId, userId, userId, userId],
  );
  return rows.map((row) => {
    const last = row.last ? JSON.parse(row.last) : null;
    const preview = last ? (last.kind === 'system' ? last.body : `${last.sender === userId ? 'Você' : last.name.split(' ')[0]}: ${last.body}`) : '';
    return {
      id: row.id,
      name: row.name,
      members: Number(row.members),
      isOwner: row.owner_id === userId,
      lastMessage: last ? { id: last.id, fromMe: last.sender === userId, preview: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview, at: last.at } : null,
      unread: Number(row.unread || 0),
    };
  }).sort((left, right) => (right.lastMessage?.at || '').localeCompare(left.lastMessage?.at || '') || left.name.localeCompare(right.name, 'pt-BR'));
}

export async function unreadGroupMessages(db, userId) {
  const row = await db.first(
    `SELECT COUNT(*) AS total FROM chat_group_messages c
       JOIN chat_group_members m ON m.group_id = c.group_id AND m.user_id = ?
      WHERE c.kind = 'text' AND c.sender_id <> ? AND c.created_at > m.last_read_at AND ${HIDDEN('c.sender_id')}`,
    [userId, userId, userId],
  );
  return Number(row?.total || 0);
}

export async function getGroupThread(db, userId, id) {
  const group = await membership(db, userId, id);
  const members = await db.all(
    `SELECT u.id, u.name, json_extract(d.data, '$.profile.avatar') AS avatar, m.joined_at
       FROM chat_group_members m JOIN users u ON u.id = m.user_id LEFT JOIN account_documents d ON d.user_id = u.id
      WHERE m.group_id = ? ORDER BY m.joined_at, u.name COLLATE NOCASE`,
    [group.id],
  );
  const rows = await db.all(
    `SELECT c.id, c.sender_id, c.body, c.reference, c.kind, c.created_at FROM chat_group_messages c
      WHERE c.group_id = ? AND (c.kind = 'system' OR ${HIDDEN('c.sender_id')})
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    [group.id, userId, MAX_MESSAGES_PER_THREAD],
  );
  const byId = new Map(members.map((member) => [member.id, member]));
  return {
    group: { id: group.id, name: group.name, ownerId: group.owner_id, isOwner: group.owner_id === userId, createdAt: group.created_at },
    members: members.map((member) => ({
      id: member.id, name: member.name, avatar: sanitizeProfileImage(member.avatar), isOwner: member.id === group.owner_id, isMe: member.id === userId,
    })),
    messages: rows.reverse().map((row) => {
      const sender = byId.get(row.sender_id);
      return {
        id: row.id,
        kind: row.kind,
        fromMe: row.sender_id === userId,
        senderId: row.sender_id,
        sender: sender ? { id: sender.id, name: sender.name, avatar: sanitizeProfileImage(sender.avatar) } : { id: row.sender_id, name: 'Ex-participante', avatar: '' },
        body: row.body,
        reference: serializeReference(row.reference),
        at: row.created_at,
      };
    }),
    canMessage: true,
  };
}

export async function groupMemberIds(db, id) {
  return (await db.all('SELECT user_id FROM chat_group_members WHERE group_id = ?', [id])).map((row) => row.user_id);
}

export async function sendGroupMessage(db, userId, id, { body, reference } = {}, now = Date.now()) {
  const group = await membership(db, userId, id);
  const text = cleanBody(body);
  const ref = cleanReference(reference);
  if (!text && !ref) throw new MessagesError('Escreva uma mensagem ou escolha um material.', 'empty_message', 400);
  const messageId = crypto.randomUUID();
  await db.run(
    "INSERT INTO chat_group_messages (id, group_id, sender_id, body, reference, kind, created_at) VALUES (?, ?, ?, ?, ?, 'text', ?)",
    [messageId, group.id, userId, text, ref ? JSON.stringify(ref) : null, iso(now)],
  );
  await db.run('UPDATE chat_group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?', [iso(now), group.id, userId]);
  return { message: { id: messageId, kind: 'text', fromMe: true, senderId: userId, body: text, reference: ref, at: iso(now) }, memberIds: await groupMemberIds(db, group.id) };
}

export async function markGroupRead(db, userId, id, now = Date.now()) {
  const group = await membership(db, userId, id);
  const read = await db.run('UPDATE chat_group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?', [iso(now), group.id, userId]);
  return { read };
}

export async function renameGroup(db, userId, id, name, now = Date.now()) {
  const group = await membership(db, userId, id);
  if (group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode mudar o nome.', 'not_owner', 403);
  const title = groupName(name);
  await db.run('UPDATE chat_groups SET name = ? WHERE id = ?', [title, group.id]);
  await addSystemMessage(db, group.id, userId, `${await userName(db, userId)} mudou o nome do grupo para “${title}”.`, now);
  return { id: group.id, name: title, memberIds: await groupMemberIds(db, group.id) };
}

export async function addGroupMembers(db, userId, id, { memberIds } = {}, now = Date.now()) {
  const group = await membership(db, userId, id);
  if (group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode adicionar pessoas.', 'not_owner', 403);
  const current = new Set(await groupMemberIds(db, group.id));
  const fresh = uniqueIds(memberIds, userId).filter((member) => !current.has(member));
  if (!fresh.length) throw new MessagesError('Escolha amigos que ainda não estão no grupo.', 'nobody_to_add', 400);
  if (current.size + fresh.length > GROUP_MAX_MEMBERS) throw new MessagesError(`Um grupo pode ter até ${GROUP_MAX_MEMBERS} pessoas.`, 'group_too_large', 400);
  await assertAddable(db, userId, fresh);
  const at = iso(now);
  await db.batch(fresh.map((member) => [
    'INSERT INTO chat_group_members (group_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)',
    [group.id, member, at, at],
  ]));
  const names = [];
  for (const member of fresh) names.push(await userName(db, member));
  await addSystemMessage(db, group.id, userId, `${await userName(db, userId)} adicionou ${names.join(', ')}.`, now);
  return { id: group.id, added: fresh, memberIds: await groupMemberIds(db, group.id) };
}

// A própria pessoa sai; a dona do grupo também pode remover alguém.
export async function removeGroupMember(db, userId, id, targetId, now = Date.now()) {
  const group = await membership(db, userId, id);
  const leaving = targetId === userId;
  if (!leaving && group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode remover pessoas.', 'not_owner', 403);
  const target = await db.first('SELECT 1 AS ok FROM chat_group_members WHERE group_id = ? AND user_id = ?', [group.id, targetId]);
  if (!target) throw new MessagesError('Essa pessoa não está no grupo.', 'not_member', 404);
  const before = await groupMemberIds(db, group.id);
  const name = await userName(db, targetId);
  await db.run('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?', [group.id, targetId]);
  const remaining = before.filter((member) => member !== targetId);
  if (!remaining.length) {
    await db.run('DELETE FROM chat_groups WHERE id = ?', [group.id]);
    return { id: group.id, removed: targetId, deleted: true, memberIds: before };
  }
  if (leaving && group.owner_id === userId) {
    const heir = await db.first('SELECT user_id FROM chat_group_members WHERE group_id = ? ORDER BY joined_at, user_id LIMIT 1', [group.id]);
    await db.run('UPDATE chat_groups SET owner_id = ? WHERE id = ?', [heir.user_id, group.id]);
  }
  await addSystemMessage(db, group.id, userId, leaving ? `${name} saiu do grupo.` : `${await userName(db, userId)} removeu ${name}.`, now);
  return { id: group.id, removed: targetId, deleted: false, memberIds: before };
}

export async function deleteGroup(db, userId, id) {
  const group = await membership(db, userId, id);
  if (group.owner_id !== userId) throw new MessagesError('Só quem criou o grupo pode apagá-lo.', 'not_owner', 403);
  const memberIds = await groupMemberIds(db, group.id);
  await db.run('DELETE FROM chat_groups WHERE id = ?', [group.id]);
  return { deleted: true, memberIds };
}
