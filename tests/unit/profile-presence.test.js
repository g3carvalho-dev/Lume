import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, sqliteAdapter } from '../../api/adapters/sqlite.js';
import { readFriendProfile, touchUserPresence } from '../../api/domain/friends.js';
import { ensureLibrary } from '../../api/domain/library-store.js';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite, fileURLToPath(new URL('../../migrations/', import.meta.url)));
  return sqliteAdapter(sqlite);
}

async function addUser(db, id) {
  await db.run('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [id, id, `${id}@example.test`, 'x', new Date().toISOString()]);
}

test('todo perfil aberto traz a presença: offline, online e estudando', async () => {
  const db = makeDb();
  await addUser(db, 'viewer');
  await addUser(db, 'alvo');

  // Perfil público (padrão): quem não é amigo também vê a presença.
  assert.equal((await readFriendProfile(db, 'viewer', 'alvo')).presence.status, 'offline');

  await touchUserPresence(db, 'alvo');
  const online = (await readFriendProfile(db, 'viewer', 'alvo')).presence;
  assert.equal(online.status, 'online');
  assert.equal(online.label, 'Online');

  const session = { status: 'active', label: 'Leitura — Direito Penal', lastTickAt: new Date().toISOString() };
  await ensureLibrary(db, 'alvo');
  const patch = async (extra) => {
    const row = await db.first('SELECT data FROM account_documents WHERE user_id = ?', ['alvo']);
    await db.run('UPDATE account_documents SET data = ? WHERE user_id = ?', [JSON.stringify({ ...JSON.parse(row.data), ...extra }), 'alvo']);
  };
  await patch({ activeSession: session });
  const studying = (await readFriendProfile(db, 'viewer', 'alvo')).presence;
  assert.equal(studying.status, 'studying');
  assert.equal(studying.topic, 'Leitura — Direito Penal');

  // Sem compartilhar a biblioteca, o tema some mas o estado continua.
  await patch({ preferences: { sharing: { library: false } } });
  const hidden = (await readFriendProfile(db, 'viewer', 'alvo')).presence;
  assert.equal(hidden.status, 'studying');
  assert.equal(hidden.topic, '');
});
