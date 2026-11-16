import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, sqliteAdapter } from '../../api/adapters/sqlite.js';
import {
  blockContact, getThread, listConversations, muteDirect, reactToDirectMessage, sendMessage, unreadSummary,
} from '../../api/domain/messages.js';
import {
  createGroup, getGroupThread, listGroups, muteGroup, reactToGroupMessage, removeGroupMember, sendGroupMessage, unreadGroupMessages,
} from '../../api/domain/groups.js';
import { readPersonCard } from '../../api/domain/friends.js';

// Responder citando, GIF, reações e silenciar em conversas diretas e grupos, e o
// cartão rápido da pessoa. Nada disso gera XP.

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite, fileURLToPath(new URL('../../migrations/', import.meta.url)));
  const db = sqliteAdapter(sqlite);
  for (const [id, name] of [['u1', 'Ana'], ['u2', 'Bia'], ['u3', 'Carla'], ['u4', 'Duda']]) {
    sqlite.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, `${id}@example.test`, 'x', '2026-10-31T12:00:00Z');
  }
  for (const [a, b] of [['u1', 'u2'], ['u2', 'u1'], ['u1', 'u3'], ['u3', 'u1']]) {
    sqlite.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(a, b, '2026-10-31T12:00:00Z');
  }
  return { db, sqlite };
}

const NOW = Date.parse('2026-11-15T12:00:00Z');
const GIF = 'https://media1.giphy.com/media/abc123/giphy.gif';

test('conversa direta: citar, GIF e reações com emojis da lista', async () => {
  const { db, sqlite } = makeDb();
  const first = await sendMessage(db, 'u1', 'u2', { body: 'Revisão de cálculo amanhã?' }, NOW);
  const reply = await sendMessage(db, 'u2', 'u1', { body: 'Bora!', replyToId: first.message.id }, NOW + 1000);
  assert.equal(reply.message.replyTo.id, first.message.id);
  assert.equal(reply.message.replyTo.senderName, 'Ana');
  assert.match(reply.message.replyTo.preview, /cálculo/);

  const gif = await sendMessage(db, 'u1', 'u2', { gifUrl: GIF }, NOW + 2000);
  assert.equal(gif.message.gif, GIF);
  await assert.rejects(() => sendMessage(db, 'u1', 'u2', { gifUrl: 'https://example.com/x.gif' }, NOW), { code: 'invalid_gif' });
  await assert.rejects(() => sendMessage(db, 'u1', 'u2', { body: 'x', replyToId: 'nao-existe' }, NOW), { code: 'message_not_found' });

  // Citar mensagem de outra conversa não é aceito.
  const other = await sendMessage(db, 'u1', 'u3', { body: 'Oi Carla' }, NOW);
  await assert.rejects(() => sendMessage(db, 'u1', 'u2', { body: 'x', replyToId: other.message.id }, NOW), { code: 'message_not_found' });

  await reactToDirectMessage(db, 'u2', 'u1', first.message.id, '😂', true, NOW + 3000);
  await reactToDirectMessage(db, 'u2', 'u1', first.message.id, '😂', true, NOW + 3001);
  await reactToDirectMessage(db, 'u1', 'u2', first.message.id, '😂', true, NOW + 3002);
  await assert.rejects(() => reactToDirectMessage(db, 'u1', 'u2', first.message.id, '🤡', true, NOW), { code: 'invalid_emoji' });
  await assert.rejects(() => reactToDirectMessage(db, 'u1', 'u2', other.message.id, '😂', true, NOW), { code: 'message_not_found' });

  const thread = await getThread(db, 'u1', 'u2');
  const reacted = thread.messages.find((item) => item.id === first.message.id);
  assert.deepEqual(reacted.reactions, [{ emoji: '😂', count: 2, mine: true }]);
  assert.equal(thread.messages.find((item) => item.id === reply.message.id).replyTo.id, first.message.id);
  assert.equal(thread.messages.at(-1).gif, GIF);

  await reactToDirectMessage(db, 'u1', 'u2', first.message.id, '😂', false, NOW + 4000);
  const after = await getThread(db, 'u2', 'u1');
  assert.deepEqual(after.messages.find((item) => item.id === first.message.id).reactions, [{ emoji: '😂', count: 1, mine: true }]);

  const list = await listConversations(db, 'u2');
  assert.equal(list.conversations[0].lastMessage.preview, 'GIF');

  // Bloqueio impede reagir, como impede escrever.
  await blockContact(db, 'u2', 'u1', NOW + 5000);
  await assert.rejects(() => reactToDirectMessage(db, 'u1', 'u2', first.message.id, '❤️', true, NOW), { code: 'blocked_by_them' });

  // Nada disso gera XP.
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM xp_events').get().n, 0);
});

test('silenciar conversa direta tira do contador sem apagar as mensagens', async () => {
  const { db } = makeDb();
  await sendMessage(db, 'u2', 'u1', { body: 'Oi' }, NOW);
  assert.equal((await unreadSummary(db, 'u1')).unread, 1);
  await muteDirect(db, 'u1', 'u2', true, NOW);
  assert.equal((await unreadSummary(db, 'u1')).unread, 0);
  const list = await listConversations(db, 'u1');
  assert.equal(list.conversations.find((item) => item.id === 'u2').muted, true);
  assert.equal(list.conversations.find((item) => item.id === 'u2').unread, 1);
  assert.equal((await getThread(db, 'u1', 'u2')).muted, true);
  await muteDirect(db, 'u1', 'u2', false, NOW);
  assert.equal((await unreadSummary(db, 'u1')).unread, 1);
  await assert.rejects(() => muteDirect(db, 'u1', 'u4', true, NOW), { code: 'not_friends' });
  await assert.rejects(() => muteDirect(db, 'u1', 'u2', 'sim', NOW), { code: 'invalid_preference' });
});

test('grupo: citar, GIF, reagir, silenciar e a própria pessoa sair', async () => {
  const { db } = makeDb();
  const { id } = await createGroup(db, 'u1', { name: 'Turma', memberIds: ['u2', 'u3'] }, NOW);
  const first = await sendGroupMessage(db, 'u2', id, { body: 'Alguém tem o resumo?' }, NOW + 1000);
  const reply = await sendGroupMessage(db, 'u3', id, { body: 'Tenho', replyToId: first.message.id, gifUrl: GIF }, NOW + 2000);
  assert.equal(reply.message.replyTo.senderName, 'Bia');
  assert.equal(reply.message.gif, GIF);

  await reactToGroupMessage(db, 'u1', id, first.message.id, '🙌', true, NOW + 3000);
  await assert.rejects(() => reactToGroupMessage(db, 'u4', id, first.message.id, '🙌', true, NOW), { code: 'group_not_found' });
  const thread = await getGroupThread(db, 'u3', id);
  assert.deepEqual(thread.messages.find((item) => item.id === first.message.id).reactions, [{ emoji: '🙌', count: 1, mine: false }]);
  assert.equal(thread.messages.find((item) => item.id === reply.message.id).replyTo.id, first.message.id);

  assert.equal(await unreadGroupMessages(db, 'u1'), 2);
  await muteGroup(db, 'u1', id, true, NOW);
  assert.equal(await unreadGroupMessages(db, 'u1'), 0);
  assert.equal((await listGroups(db, 'u1'))[0].muted, true);
  assert.equal((await getGroupThread(db, 'u1', id)).muted, true);

  // A própria pessoa sai do grupo pelas regras atuais (remover a si mesma).
  const left = await removeGroupMember(db, 'u2', id, 'u2', NOW + 4000);
  assert.equal(left.deleted, false);
  await assert.rejects(() => getGroupThread(db, 'u2', id), { code: 'group_not_found' });
  // A mensagem citada de quem saiu continua legível na citação.
  const later = await getGroupThread(db, 'u1', id);
  assert.equal(later.messages.find((item) => item.id === reply.message.id).replyTo.senderName, 'Bia');
});

test('cartão rápido: nível pela escolha de XP, posição só para quem participa', async () => {
  const { db, sqlite } = makeDb();
  const card = await readPersonCard(db, 'u1', 'u2');
  assert.equal(card.person.name, 'Bia');
  assert.equal(card.relation, 'friend');
  assert.equal(card.canMessage, true);
  assert.equal(card.ranking, null);

  sqlite.prepare("INSERT INTO xp_settings (user_id, eligible_since, ranking_opt_in, time_zone, updated_at) VALUES ('u2', ?, 1, 'UTC', ?)").run('2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z');
  const ranked = await readPersonCard(db, 'u1', 'u2');
  assert.equal(ranked.ranking.position, 1);

  // Sem amizade e com perfil público (padrão): abre, sem posição nem mensagem.
  const stranger = await readPersonCard(db, 'u4', 'u2');
  assert.equal(stranger.relation, 'public');
  assert.equal(stranger.ranking, null);
  assert.equal(stranger.canMessage, false);

  await blockContact(db, 'u2', 'u4', NOW);
  await assert.rejects(() => readPersonCard(db, 'u4', 'u2'), { code: 'not_friends' });
  const self = await readPersonCard(db, 'u1', 'u1');
  assert.equal(self.relation, 'self');
});
