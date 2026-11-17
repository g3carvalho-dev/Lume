import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, sqliteAdapter } from '../../api/adapters/sqlite.js';
import { listProfileFriends, readFriendProfile, readPersonCard } from '../../api/domain/friends.js';
import { searchByHandle } from '../../api/domain/friend-requests.js';
import {
  createSocialComment, createSocialPost, deleteSocialPost, listProfilePosts, listSocialPosts, pinSocialPost,
  reactToSocialPost, readSocialAttachment,
} from '../../api/domain/social-feed.js';
import { createInitialState, restoreState } from '../../public/domain.js';
import { setPrivacy } from '../../public/settings-domain.js';
import {
  audienceSentence, canSee, defaultPrivacy, normalizePrivacy, profileAccess, sectionAudience,
} from '../../public/privacy-domain.js';
import { buildProfile } from '../../public/profile-domain.js';
import { stepUnits } from '../../public/material-model.js';

// ana: dona do perfil · bia: amiga · caio: conta sem vínculo · duda: bloqueada por ana
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  applyMigrations(sql, fileURLToPath(new URL('../../migrations/', import.meta.url)));
  for (const [id, name] of [['ana', 'Ana'], ['bia', 'Bia'], ['caio', 'Caio'], ['duda', 'Duda']]) {
    sql.prepare('INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)').run(id, name, `${id}@example.test`, 'x', '2026-11-12T12:00:00Z');
    sql.prepare('INSERT INTO user_handles (user_id, handle, created_at) VALUES (?,?,?)').run(id, id, '2026-11-12T12:00:00Z');
  }
  sql.exec("INSERT INTO friendships VALUES ('ana','bia','2026-11-12'), ('bia','ana','2026-11-12')");
  sql.exec("INSERT INTO friendships VALUES ('ana','duda','2026-11-12'), ('duda','ana','2026-11-12')");
  sql.exec("INSERT INTO contact_blocks (user_id,blocked_id,created_at) VALUES ('ana','duda','2026-11-12')");
  const objects = new Map();
  const bucket = { async put(key, bytes) { objects.set(key, bytes); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(key) { objects.delete(key); } };
  const db = sqliteAdapter(sql);
  // Guarda as preferências cruas, como contas antigas que ainda não regravaram o documento.
  const setPrefs = (userId, preferences, extra = {}) => {
    const state = { ...createInitialState(), ...extra };
    const { courses, progress, tasks, studySessions, agenda, subjects, ...document } = state;
    document.preferences = preferences;
    sql.prepare(`INSERT INTO account_documents (user_id,data,revision,updated_at) VALUES (?,?,1,?)
      ON CONFLICT(user_id) DO UPDATE SET data=excluded.data`).run(userId, JSON.stringify(document), '2026-11-12T12:00:00Z');
  };
  return { db, sql, bucket, setPrefs };
}

const open = (patch = {}) => ({ ...createInitialState().preferences, privacy: { ...defaultPrivacy(), ...patch } });

test('alcance: chave geral define o padrão e cada seção pode ser ajustada', () => {
  const privacy = normalizePrivacy({ privacy: { mode: 'open', posts: 'friends', activity: 'self' } });
  assert.equal(sectionAudience(privacy, 'achievements'), 'all');
  assert.equal(sectionAudience(privacy, 'posts'), 'friends');
  assert.equal(sectionAudience(privacy, 'activity'), 'self');
  // Perfil privado: o padrão vira Só amigos e "Todos" não passa de amigos.
  const closed = normalizePrivacy({ privacy: { mode: 'private', posts: 'all' } });
  assert.equal(sectionAudience(closed, 'friends'), 'friends');
  assert.equal(sectionAudience(closed, 'posts'), 'friends');
  assert.equal(canSee('all', 'member'), true);
  assert.equal(canSee('friends', 'member'), false);
  assert.equal(canSee('friends', 'friend'), true);
  assert.equal(canSee('self', 'friend'), false);
  assert.equal(canSee('self', 'self'), true);
  assert.equal(canSee('all', 'blocked'), false);
  assert.deepEqual(profileAccess(undefined, 'blocked').sections, { posts: false, activity: false, achievements: false, friends: false });
  assert.equal(profileAccess({ privacy: { mode: 'private' } }, 'member').open, false);
  assert.match(audienceSentence(privacy, 'posts'), /Só seus amigos/);
});

test('contas antigas: publicações em Só amigos, o resto herda as escolhas que já existiam', () => {
  assert.deepEqual(normalizePrivacy({ sharing: { library: true, queue: true, progress: true, xp: true, public: true } }),
    { mode: 'open', posts: 'friends', activity: null, achievements: null, friends: null });
  assert.deepEqual(normalizePrivacy({ sharing: { library: false, xp: false, public: false } }),
    { mode: 'private', posts: 'friends', activity: 'self', achievements: 'self', friends: null });
  assert.equal(normalizePrivacy({ sharing: { progress: false } }).activity, 'self');
  // restoreState grava a conversão e preserva as chaves antigas nos dados.
  const legacy = createInitialState();
  delete legacy.preferences.privacy;
  legacy.preferences.sharing = { library: true, queue: false, progress: true, xp: false, public: true };
  const restored = restoreState(JSON.stringify(legacy));
  assert.deepEqual(restored.preferences.privacy, { mode: 'open', posts: 'friends', activity: null, achievements: 'self', friends: null });
  assert.equal(restored.preferences.sharing.queue, false);
  // Contas novas também começam com publicações só entre amigos.
  assert.equal(createInitialState().preferences.privacy.posts, 'friends');
});

test('setPrivacy troca a chave geral ou uma seção e acompanha a chave antiga', () => {
  let state = restoreState(createInitialState());
  state = setPrivacy(state, { mode: 'private' });
  assert.equal(state.preferences.privacy.mode, 'private');
  assert.equal(state.preferences.sharing.public, false);
  state = setPrivacy(state, { friends: 'self', posts: 'qualquer' });
  assert.equal(state.preferences.privacy.friends, 'self');
  assert.equal(state.preferences.privacy.posts, null, 'valor desconhecido volta ao padrão');
  assert.deepEqual(restoreState(JSON.stringify(state)).preferences.privacy, state.preferences.privacy);
});

test('buildProfile projeta só as seções da relação e nunca a configuração alheia', () => {
  const state = restoreState({
    ...createInitialState(),
    courses: [{ id: 'c1', title: 'Redes', type: 'course', url: '', units: stepUnits([{ id: 's1', title: 'Aula 1' }, { id: 's2', title: 'Aula 2' }]) }],
    progress: [{ id: 's1', unitId: 's1', materialId: 'c1', type: 'completion', origin: 'manual', historical: false, at: '2026-11-10T12:00:00Z' }],
    preferences: open({ activity: 'friends', achievements: 'self' }),
  });
  const now = Date.parse('2026-11-16T12:00:00Z');
  const own = buildProfile(state, { now });
  assert.equal(own.activity[0].lastStep, 'Aula 1');
  assert.equal(own.stats.materials, 1);
  assert.ok(own.privacy);
  const friend = buildProfile(state, { now, relation: 'friend' });
  assert.equal(friend.activity.length, 1);
  assert.equal(friend.stats.level, null);
  assert.equal(friend.achievements, null);
  assert.equal(friend.privacy, undefined);
  assert.deepEqual(friend.visibility, { posts: true, activity: true, achievements: false, friends: true });
  const member = buildProfile(state, { now, relation: 'member' });
  assert.equal(member.activity, null);
  assert.equal(member.stats.materials, null);
  assert.equal(member.stats.doneLessons, null);
  assert.equal(member.visibility.posts, false, 'publicações começam em Só amigos');
});

test('servidor: perfil aberto por relação — dona, amiga, conta sem vínculo e bloqueio', async t => {
  const { db, setPrefs } = fixture(t);
  setPrefs('ana', open({ activity: 'friends', friends: 'self' }));
  const asFriend = await readFriendProfile(db, 'bia', 'ana');
  assert.equal(asFriend.relation, 'friend');
  assert.deepEqual(asFriend.visibility, { posts: true, activity: true, achievements: true, friends: false });
  assert.notEqual(asFriend.activity, null);
  const asMember = await readFriendProfile(db, 'caio', 'ana');
  assert.equal(asMember.relation, 'member');
  assert.equal(asMember.activity, null);
  assert.equal(asMember.stats.materials, null);
  assert.notEqual(asMember.stats.level, null);
  // Bloqueio nega tudo, mesmo havendo amizade, nos dois sentidos.
  await assert.rejects(readFriendProfile(db, 'duda', 'ana'), { code: 'not_friends' });
  setPrefs('duda', open());
  await assert.rejects(readFriendProfile(db, 'ana', 'duda'), { code: 'not_friends' });
  await assert.rejects(readPersonCard(db, 'duda', 'ana'), { code: 'not_friends' });
  // Perfil privado: só amigos abrem; quem não tem vínculo nem acha pelo @usuário.
  setPrefs('ana', open({ mode: 'private' }));
  await assert.rejects(readFriendProfile(db, 'caio', 'ana'), { code: 'not_friends' });
  await assert.rejects(searchByHandle(db, 'caio', 'ana'), { code: 'not_found' });
  assert.equal((await readFriendProfile(db, 'bia', 'ana')).visibility.activity, true);
});

test('servidor: lista de amigos e nível respeitam o alcance', async t => {
  const { db, setPrefs } = fixture(t);
  setPrefs('ana', open({ friends: 'friends', achievements: 'friends' }));
  setPrefs('bia', open());
  const own = await listProfileFriends(db, 'ana', 'ana');
  assert.deepEqual(own.friends.map((item) => item.id).sort(), ['bia'], 'bloqueada não aparece nem para a dona');
  assert.deepEqual((await listProfileFriends(db, 'bia', 'ana')).friends.map((item) => item.id), ['bia', 'duda'], 'o bloqueio é entre ana e duda, não com bia');
  const hidden = await listProfileFriends(db, 'caio', 'ana');
  assert.deepEqual(hidden, { hidden: true, friends: [], total: null });
  assert.equal((await readPersonCard(db, 'caio', 'ana')).level, null);
  await assert.rejects(listProfileFriends(db, 'duda', 'ana'), { code: 'not_friends' });
  // Amiga com perfil privado só aparece para quem também é amigo dela.
  setPrefs('ana', open({ friends: 'all' }));
  setPrefs('bia', open({ mode: 'private' }));
  assert.deepEqual((await listProfileFriends(db, 'caio', 'ana')).friends.map((item) => item.id), ['duda']);
  assert.equal((await listProfileFriends(db, 'ana', 'ana')).friends.length, 1);
});

test('publicações no perfil: alcance, só leitura para quem não é amigo e Feed só entre amigos', async t => {
  const { db, bucket, setPrefs } = fixture(t);
  setPrefs('ana', open({ posts: 'all' }));
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await createSocialPost(db, bucket, 'ana', { id: 'p1', body: 'Primeira' }, null, Date.parse('2026-11-14T12:00:00Z'));
  await createSocialPost(db, bucket, 'ana', { id: 'p2', body: 'Com foto' }, { name: 'a.png', bytes }, Date.parse('2026-11-15T12:00:00Z'));
  const asMember = await listProfilePosts(db, 'caio', 'ana');
  assert.deepEqual(asMember.posts.map((post) => post.id), ['p2', 'p1']);
  assert.equal(asMember.readOnly, true);
  assert.equal(asMember.posts[0].readOnly, true);
  assert.equal((await readSocialAttachment(db, bucket, 'caio', 'p2')).type, 'image/png');
  // Reagir e comentar continuam só entre amigos; o Feed também.
  await assert.rejects(reactToSocialPost(db, 'caio', 'p1', true), { code: 'post_not_found' });
  await assert.rejects(createSocialComment(db, 'caio', 'p1', { id: 'c1', body: 'Oi' }), { code: 'post_not_found' });
  assert.equal((await listSocialPosts(db, 'caio')).posts.length, 0);
  assert.equal((await listProfilePosts(db, 'bia', 'ana')).readOnly, false);
  // Só amigos: a conta sem vínculo perde lista e anexo.
  setPrefs('ana', open({ posts: 'friends' }));
  assert.deepEqual(await listProfilePosts(db, 'caio', 'ana'), { hidden: true, posts: [], pinned: null, nextCursor: null });
  await assert.rejects(readSocialAttachment(db, bucket, 'caio', 'p2'), { code: 'post_not_found' });
  assert.equal((await listProfilePosts(db, 'bia', 'ana')).posts.length, 2);
  // Só eu: some do perfil para a amiga, mas o Feed entre amigos continua.
  setPrefs('ana', open({ posts: 'self' }));
  assert.equal((await listProfilePosts(db, 'bia', 'ana')).hidden, true);
  assert.equal((await listSocialPosts(db, 'bia')).posts.length, 2);
  assert.equal((await readSocialAttachment(db, bucket, 'bia', 'p2')).type, 'image/png');
  assert.equal((await listProfilePosts(db, 'ana', 'ana')).posts.length, 2);
  // Bloqueio nega tudo.
  await assert.rejects(listProfilePosts(db, 'duda', 'ana'), { code: 'not_friends' });
  await assert.rejects(readSocialAttachment(db, bucket, 'duda', 'p2'), { code: 'post_not_found' });
});

test('fixar: uma publicação própria por pessoa, no topo e fora da lista; excluir solta', async t => {
  const { db, bucket, setPrefs } = fixture(t);
  setPrefs('ana', open({ posts: 'all' }));
  await createSocialPost(db, bucket, 'ana', { id: 'p1', body: 'Uma' }, null, Date.parse('2026-11-14T12:00:00Z'));
  await createSocialPost(db, bucket, 'ana', { id: 'p2', body: 'Duas' }, null, Date.parse('2026-11-15T12:00:00Z'));
  await createSocialPost(db, bucket, 'bia', { id: 'b1', body: 'Da Bia' });
  await assert.rejects(pinSocialPost(db, 'ana', 'b1', true), { code: 'post_not_found' });
  await pinSocialPost(db, 'ana', 'p1', true);
  let page = await listProfilePosts(db, 'caio', 'ana');
  assert.equal(page.pinned.id, 'p1');
  assert.equal(page.pinned.pinned, true);
  assert.deepEqual(page.posts.map((post) => post.id), ['p2']);
  await pinSocialPost(db, 'ana', 'p2', true);
  page = await listProfilePosts(db, 'ana', 'ana');
  assert.equal(page.pinned.id, 'p2');
  assert.deepEqual(page.posts.map((post) => post.id), ['p1']);
  await pinSocialPost(db, 'ana', 'p2', false);
  assert.equal((await listProfilePosts(db, 'ana', 'ana')).pinned, null);
  await pinSocialPost(db, 'ana', 'p1', true);
  await deleteSocialPost(db, bucket, 'ana', 'p1');
  page = await listProfilePosts(db, 'ana', 'ana');
  assert.equal(page.pinned, null);
  assert.deepEqual(page.posts.map((post) => post.id), ['p2']);
});
