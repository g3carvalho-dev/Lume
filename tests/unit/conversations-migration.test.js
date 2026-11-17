import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from '../../api/adapters/sqlite.js';

// A migração 0027 copia mensagens diretas e grupos para o modelo de conversas.
// O teste monta o banco como estava na 0026, semeia dados antigos e confere a cópia.

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));
const at = (seconds, ms = 0) => new Date(Date.UTC(2026, 10, 1, 12, 0, seconds, ms)).toISOString();

function seeded() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db, MIGRATIONS, { only: /^00(0\d|1\d|2[0-6])_/ });
  const user = db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const id of ['ana', 'bia', 'caio', 'duda']) user.run(id, id, `${id}@example.test`, 'x', at(0));

  const direct = db.prepare('INSERT INTO direct_messages (id, sender_id, recipient_id, body, reference, gif_url, reply_to, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  direct.run('m1', 'ana', 'bia', 'Oi', null, null, null, at(1), at(2));
  direct.run('m2', 'bia', 'ana', 'Olá', null, null, 'm1', at(3), at(4));
  direct.run('m3', 'ana', 'bia', '', null, 'https://media.giphy.com/media/a/giphy.gif', null, at(5, 250), null);
  direct.run('m4', 'ana', 'bia', 'Ainda não lida', null, null, null, at(6), null);
  direct.run('m5', 'caio', 'ana', 'Outra conversa', '{"type":"course","id":"c1","title":"Curso"}', null, null, at(7), null);

  db.prepare('INSERT INTO chat_groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').run('g1', 'Turma', 'ana', at(10));
  const member = db.prepare('INSERT INTO chat_group_members (group_id, user_id, joined_at, last_read_at) VALUES (?, ?, ?, ?)');
  member.run('g1', 'ana', at(10), at(13));
  member.run('g1', 'bia', at(10), at(11));
  member.run('g1', 'caio', at(10), at(10));
  const group = db.prepare('INSERT INTO chat_group_messages (id, group_id, sender_id, body, reference, kind, created_at, reply_to, gif_url) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL)');
  group.run('s1', 'g1', 'ana', 'ana criou o grupo.', 'system', at(10), null);
  group.run('t1', 'g1', 'ana', 'Bem-vindas', 'text', at(11), null);
  group.run('t2', 'g1', 'bia', 'Obrigada', 'text', at(12), 't1');
  group.run('t3', 'g1', 'caio', 'Cheguei', 'text', at(13), null);

  const reaction = db.prepare('INSERT INTO message_reactions (scope, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)');
  reaction.run('direct', 'm1', 'bia', '👍', at(2));
  reaction.run('group', 't1', 'caio', '🙌', at(12));
  const mute = db.prepare('INSERT INTO conversation_mutes (user_id, scope, target_id, created_at) VALUES (?, ?, ?, ?)');
  mute.run('bia', 'direct', 'ana', at(8));
  mute.run('caio', 'group', 'g1', at(14));
  mute.run('duda', 'direct', 'ana', at(9));

  applyMigrations(db, MIGRATIONS);
  return db;
}

const unread = (db, conversationId, userId) => db.prepare(
  `SELECT COUNT(*) AS n FROM conversation_messages m
     JOIN conversation_members p ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.conversation_id = ? AND m.kind = 'text' AND m.sender_id <> ? AND m.id > p.last_read_id`,
).get(userId, conversationId, userId).n;

test('conversas diretas: uma por par, ordem, citação, reação, silenciada e não lidas', () => {
  const db = seeded();
  const pair = db.prepare("SELECT id FROM conversations WHERE kind = 'direct' AND pair_key = 'ana|bia'").get();
  assert.ok(pair, 'a conversa do par existe com a chave ordenada');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE kind = 'direct'").get().n, 3, 'ana|bia, ana|caio e a só silenciada ana|duda');

  const rows = db.prepare('SELECT id, sender_id, body, gif_url, reply_to FROM conversation_messages WHERE conversation_id = ? ORDER BY id').all(pair.id);
  assert.deepEqual(rows.map((row) => row.body), ['Oi', 'Olá', '', 'Ainda não lida'], 'a ordem do id é a cronológica');
  assert.match(rows[0].id, /^\d{13}-m1$/);
  assert.equal(rows[1].reply_to, rows[0].id, 'a citação aponta para o id novo');
  assert.equal(rows[2].gif_url, 'https://media.giphy.com/media/a/giphy.gif');
  assert.ok(rows[2].id.startsWith(String(Date.parse(at(5, 250))).padStart(13, '0')), 'os milissegundos entram no id');

  assert.equal(unread(db, pair.id, 'bia'), 2, 'as duas últimas de ana continuam não lidas para bia');
  assert.equal(unread(db, pair.id, 'ana'), 0);
  const members = db.prepare('SELECT user_id, muted, last_read_at FROM conversation_members WHERE conversation_id = ? ORDER BY user_id').all(pair.id);
  assert.deepEqual(members.map((row) => [row.user_id, row.muted]), [['ana', 0], ['bia', 1]]);
  assert.equal(members[0].last_read_at, at(4));

  assert.deepEqual(
    db.prepare('SELECT message_id, user_id, emoji FROM conversation_reactions WHERE conversation_id = ?').all(pair.id).map((row) => ({ ...row })),
    [{ message_id: rows[0].id, user_id: 'bia', emoji: '👍' }],
  );

  const other = db.prepare("SELECT id FROM conversations WHERE pair_key = 'ana|caio'").get();
  assert.equal(unread(db, other.id, 'ana'), 1);
  assert.match(db.prepare('SELECT reference FROM conversation_messages WHERE conversation_id = ?').get(other.id).reference, /"c1"/);

  const mutedOnly = db.prepare("SELECT id FROM conversations WHERE pair_key = 'ana|duda'").get();
  assert.equal(db.prepare('SELECT muted FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(mutedOnly.id, 'duda').muted, 1);
});

test('grupos: mesmo id, membros, mensagens de sistema, não lidas e reações', () => {
  const db = seeded();
  const group = db.prepare("SELECT kind, name, owner_id, pair_key FROM conversations WHERE id = 'g1'").get();
  assert.deepEqual({ ...group }, { kind: 'group', name: 'Turma', owner_id: 'ana', pair_key: null });
  const rows = db.prepare("SELECT id, kind, body, reply_to FROM conversation_messages WHERE conversation_id = 'g1' ORDER BY id").all();
  assert.deepEqual(rows.map((row) => row.kind), ['system', 'text', 'text', 'text']);
  assert.equal(rows[2].reply_to, rows[1].id);

  assert.equal(unread(db, 'g1', 'ana'), 0, 'leu até a última');
  assert.equal(unread(db, 'g1', 'bia'), 1, 'só a de caio, depois da leitura dela');
  assert.equal(unread(db, 'g1', 'caio'), 2);
  assert.equal(db.prepare("SELECT muted FROM conversation_members WHERE conversation_id = 'g1' AND user_id = 'caio'").get().muted, 1);
  assert.equal(db.prepare("SELECT message_id FROM conversation_reactions WHERE conversation_id = 'g1'").get().message_id, rows[1].id);
});

test('as tabelas antigas ficam intactas como arquivo', () => {
  const db = seeded();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM direct_messages').get().n, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_group_messages').get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_reactions').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_mutes').get().n, 3);
});

test('thread e última mensagem saem do índice, sem varredura nem ordenação temporária', () => {
  const db = seeded();
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join(' | ');
  const page = plan("SELECT id FROM conversation_messages WHERE conversation_id = 'g1' AND id < 'z' ORDER BY id DESC LIMIT 50");
  assert.match(page, /SEARCH/);
  assert.doesNotMatch(page, /SCAN|TEMP B-TREE/);
});
