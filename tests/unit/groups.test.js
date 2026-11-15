import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, sqliteAdapter } from '../../api/adapters/sqlite.js';
import {
  addGroupMembers, createGroup, deleteGroup, getGroupThread, listGroups, markGroupRead, removeGroupMember,
  renameGroup, sendGroupMessage, unreadGroupMessages,
} from '../../api/domain/groups.js';
import { createReport, listReports, reviewReport } from '../../api/domain/reports.js';
import { sendMessage, blockContact } from '../../api/domain/messages.js';
import { listNotifications } from '../../api/domain/notifications.js';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite, fileURLToPath(new URL('../../migrations/', import.meta.url)));
  const db = sqliteAdapter(sqlite);
  for (const [id, name] of [['u1', 'Ana Souza'], ['u2', 'Bia'], ['u3', 'Carla'], ['u4', 'Duda'], ['u5', 'Eva']]) {
    sqlite.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, `${id}@example.test`, 'x', '2026-10-31T12:00:00Z');
  }
  for (const [a, b] of [['u1', 'u2'], ['u1', 'u3'], ['u1', 'u4'], ['u2', 'u1'], ['u3', 'u1'], ['u4', 'u1']]) {
    sqlite.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(a, b, '2026-10-31T12:00:00Z');
  }
  return { db, sqlite };
}

const NOW = Date.parse('2026-11-15T12:00:00Z');

test('grupo exige 3 pessoas, só amigos de quem cria, sem bloqueio', async () => {
  const { db } = makeDb();
  await assert.rejects(() => createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2'] }, NOW), { code: 'group_too_small' });
  await assert.rejects(() => createGroup(db, 'u1', { name: '  ', memberIds: ['u2', 'u3'] }, NOW), { code: 'invalid_group_name' });
  await assert.rejects(() => createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2', 'u5'] }, NOW), { code: 'not_friends' });
  await blockContact(db, 'u3', 'u1', NOW);
  await assert.rejects(() => createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2', 'u3'] }, NOW), { code: 'blocked' });
  const { id } = await createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2', 'u4'] }, NOW);
  const thread = await getGroupThread(db, 'u2', id);
  assert.equal(thread.group.name, 'Estudo');
  assert.equal(thread.members.length, 3);
  assert.equal(thread.group.isOwner, false);
  assert.equal(thread.messages[0].kind, 'system');
  await assert.rejects(() => getGroupThread(db, 'u5', id), { code: 'group_not_found' });
});

test('mensagens, não lidas, leitura e ocultar quem a pessoa bloqueou', async () => {
  const { db } = makeDb();
  const { id } = await createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2', 'u3'] }, NOW);
  await sendGroupMessage(db, 'u2', id, { body: 'Oi, grupo!' }, NOW + 1000);
  await sendGroupMessage(db, 'u3', id, { body: 'Vamos revisar?' }, NOW + 2000);
  await assert.rejects(() => sendGroupMessage(db, 'u5', id, { body: 'x' }, NOW), { code: 'group_not_found' });
  await assert.rejects(() => sendGroupMessage(db, 'u1', id, { body: '  ' }, NOW), { code: 'empty_message' });
  assert.equal(await unreadGroupMessages(db, 'u1'), 2);
  assert.equal((await listGroups(db, 'u1'))[0].unread, 2);
  assert.match((await listGroups(db, 'u1'))[0].lastMessage.preview, /^Carla: Vamos revisar\?/);
  await blockContact(db, 'u1', 'u3', NOW + 3000);
  assert.equal(await unreadGroupMessages(db, 'u1'), 1);
  assert.equal((await getGroupThread(db, 'u1', id)).messages.some((message) => message.body === 'Vamos revisar?'), false);
  assert.equal((await getGroupThread(db, 'u2', id)).messages.some((message) => message.body === 'Vamos revisar?'), true);
  await markGroupRead(db, 'u1', id, NOW + 4000);
  assert.equal(await unreadGroupMessages(db, 'u1'), 0);
});

test('dona renomeia, adiciona e remove; quem sai deixa o grupo; dona que sai passa o grupo', async () => {
  const { db } = makeDb();
  const { id } = await createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2', 'u3'] }, NOW);
  await assert.rejects(() => renameGroup(db, 'u2', id, 'Outro', NOW), { code: 'not_owner' });
  await renameGroup(db, 'u1', id, 'Direito', NOW + 1000);
  await addGroupMembers(db, 'u1', id, { memberIds: ['u4'] }, NOW + 2000);
  await assert.rejects(() => addGroupMembers(db, 'u1', id, { memberIds: ['u4'] }, NOW + 3000), { code: 'nobody_to_add' });
  await assert.rejects(() => removeGroupMember(db, 'u2', id, 'u3', NOW), { code: 'not_owner' });
  await removeGroupMember(db, 'u1', id, 'u4', NOW + 4000);
  await removeGroupMember(db, 'u2', id, 'u2', NOW + 5000);
  await assert.rejects(() => getGroupThread(db, 'u2', id), { code: 'group_not_found' });
  await removeGroupMember(db, 'u1', id, 'u1', NOW + 6000);
  const thread = await getGroupThread(db, 'u3', id);
  assert.equal(thread.group.isOwner, true);
  assert.equal(thread.group.name, 'Direito');
  await removeGroupMember(db, 'u3', id, 'u3', NOW + 7000);
  assert.deepEqual(await listGroups(db, 'u3'), []);
  const other = await createGroup(db, 'u1', { name: 'Outro', memberIds: ['u2', 'u3'] }, NOW);
  await assert.rejects(() => deleteGroup(db, 'u2', other.id), { code: 'not_owner' });
  await deleteGroup(db, 'u1', other.id);
  assert.deepEqual(await listGroups(db, 'u1'), []);
});

test('denúncia guarda cópia das mensagens, não repete no dia e só a criadora analisa', async () => {
  const { db } = makeDb();
  await sendMessage(db, 'u2', 'u1', { body: 'Mensagem ofensiva' }, NOW);
  await assert.rejects(() => createReport(db, 'u1', { context: 'direct', targetId: 'u2', reason: 'nada' }, NOW), { code: 'invalid_reason' });
  await assert.rejects(() => createReport(db, 'u1', { context: 'direct', targetId: 'u1', reason: 'spam' }, NOW), { code: 'invalid_report' });
  await assert.rejects(() => createReport(db, 'u1', { context: 'direct', targetId: 'u5', reason: 'spam' }, NOW), { code: 'not_friends' });
  const first = await createReport(db, 'u1', { context: 'direct', targetId: 'u2', reason: 'harassment', details: 'Insistiu depois de eu pedir para parar.' }, NOW + 1000);
  const again = await createReport(db, 'u1', { context: 'direct', targetId: 'u2', reason: 'harassment' }, NOW + 2000);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  const { id } = await createGroup(db, 'u1', { name: 'Estudo', memberIds: ['u2', 'u3'] }, NOW);
  const sent = await sendGroupMessage(db, 'u2', id, { body: 'Spam no grupo' }, NOW + 3000);
  await createReport(db, 'u3', { context: 'group', groupId: id, targetId: 'u2', subjectId: sent.message.id, reason: 'spam', includeContext: true }, NOW + 4000);
  await assert.rejects(() => createReport(db, 'u5', { context: 'group', groupId: id, targetId: 'u2', reason: 'spam' }, NOW), { code: 'group_not_found' });

  const list = await listReports(db);
  assert.equal(list.open, 2);
  const direct = list.reports.find((item) => item.context === 'direct');
  assert.equal(direct.reasonLabel, 'Assédio, ameaça ou ofensa');
  assert.equal(direct.evidence[0].body, 'Mensagem ofensiva');
  assert.equal(direct.evidence[0].from, 'Bia');
  assert.equal(direct.target.reportsAgainst, 2);
  assert.equal(list.reports.find((item) => item.context === 'group').evidence[0].body, 'Spam no grupo');

  assert.equal((await listNotifications(db, 'u1', NOW + 5000)).items.some((item) => item.kind === 'report'), false);
  const bell = await listNotifications(db, 'u1', NOW + 5000, { creator: true });
  assert.equal(bell.items.filter((item) => item.kind === 'report').length, 2);

  await reviewReport(db, 'u1', first.id, 'reviewed', NOW + 6000);
  assert.equal((await listReports(db)).open, 1);
  assert.equal((await listReports(db, { status: 'reviewed' })).reports.length, 1);
  await assert.rejects(() => reviewReport(db, 'u1', first.id, 'qualquer', NOW), { code: 'invalid_status' });
});
