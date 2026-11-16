import test from 'node:test';
import { stepUnits } from '../../public/material-model.js';
import assert from 'node:assert/strict';
import { buildProfile, normalizeSharing } from '../../public/profile-domain.js';
import { createInitialState, restoreState } from '../../public/domain.js';
import {
  MediaError, deleteProfileObject, detectImageType, parseMediaKeyFromPath, uploadProfileObject,
} from '../../api/domain/media.js';

function fixture() {
  const base = createInitialState();
  return {
    ...base,
    onboarded: true,
    courses: [
      { id: 'c1', title: 'Curso de redes', type: 'course', url: 'https://exemplo.test/redes', units: stepUnits([{ id: 's1', title: 'Aula 1' }, { id: 's2', title: 'Aula 2' }]) },
      { id: 'p1', title: 'Projeto público', type: 'project', shared: true, url: '', units: stepUnits([{ id: 's3', title: 'Entrega' }]) },
      { id: 'p2', title: 'Projeto privado', type: 'project', url: '', units: stepUnits([{ id: 's4', title: 'Entrega' }]) },
      { id: 'e1', title: 'Curso de exemplo', type: 'course', example: true, url: '', units: stepUnits([{ id: 's5', title: 'Aula' }]) },
      { id: 'c2', title: 'Curso concluído', type: 'course', url: '', units: stepUnits([{ id: 's6', title: 'Aula' }]) },
    ],
    progress: ['s1', 's6'].map((unitId, index) => ({ id: unitId, unitId, materialId: index ? 'c2' : 'c1', type: 'completion', origin: 'manual', historical: false, at: '2026-10-31T12:00:00Z' })),
  };
}

function withPrivacy(patch, relation = 'friend') {
  const state = restoreState(fixture());
  return buildProfile({ ...state, preferences: { ...state.preferences, privacy: { ...state.preferences.privacy, ...patch } } }, { relation });
}

test('perfil padrão mostra atividade, conquistas e nível; publicações ficam entre amigos', () => {
  const profile = buildProfile(restoreState(fixture()));
  assert.deepEqual(profile.privacy, { mode: 'open', posts: 'friends', activity: null, achievements: null, friends: null });
  assert.deepEqual(profile.audiences, { posts: 'friends', activity: 'all', achievements: 'all', friends: 'all' });
  assert.ok(profile.activity.length > 0);
  assert.equal(profile.stats.level, 1);
  assert.equal(profile.stats.doneLessons, 2);
  assert.equal(profile.stats.completedMaterials, 1);
});

test('materiais de exemplo não entram no perfil', () => {
  const profile = buildProfile(fixture());
  assert.equal(profile.activity.map((item) => item.title).includes('Curso de exemplo'), false);
  assert.equal(profile.stats.materials, 3);
});

test('projeto privado não aparece em nenhuma seção nem nas contagens', () => {
  const profile = buildProfile(fixture());
  const serialized = JSON.stringify(profile);
  assert.equal(serialized.includes('Projeto privado'), false);
});

test('Atividade em Só eu esconde materiais, progresso e contadores de quem vê', () => {
  const profile = withPrivacy({ activity: 'self' });
  assert.equal(profile.visibility.activity, false);
  assert.equal(profile.activity, null);
  assert.equal(profile.stats.materials, null);
  assert.equal(profile.stats.doneLessons, null);
  assert.equal(profile.stats.completedMaterials, null);
  assert.equal(profile.stats.recentStepsTwoWeeks, null);
});

test('Conquistas e nível em Só eu escondem nível, conquistas e destaque', () => {
  const profile = withPrivacy({ achievements: 'self' });
  assert.equal(profile.stats.xp, null);
  assert.equal(profile.stats.level, null);
  assert.equal(profile.achievements, null);
  assert.equal(profile.featuredBadge, null);
  assert.deepEqual(profile.titles, []);
});

test('atividade: um cartão por material, em andamento antes dos concluídos, tempo das últimas duas semanas', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const state = restoreState({
    ...fixture(),
    progress: [
      { id: 's1', unitId: 's1', materialId: 'c1', type: 'completion', origin: 'manual', historical: false, at: '2026-11-01T12:00:00Z' },
      { id: 's6', unitId: 's6', materialId: 'c2', type: 'completion', origin: 'manual', historical: false, at: '2026-11-15T12:00:00Z' },
    ],
    studySessions: [
      { id: 'old', courseId: 'c1', startedAt: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T11:00:00Z', durationMs: 3600000 },
      { id: 'new', courseId: 'c1', startedAt: '2026-11-14T10:00:00Z', endedAt: '2026-11-14T10:30:00Z', durationMs: 1800000 },
    ],
  });
  const profile = buildProfile(state, { now });
  assert.deepEqual(profile.activity.map((item) => item.id), ['c1', 'c2'], 'concluído recente vem depois do que está em andamento');
  assert.equal(profile.activity[0].recentMinutes, 30, 'só as últimas duas semanas');
  assert.equal(profile.activity[0].lastStep, 'Aula 1');
  assert.equal(profile.activity[0].lastAt, '2026-11-14T10:30:00.000Z');
  assert.equal(profile.activity[1].status, 'completed');
  assert.equal(profile.stats.recentStepsTwoWeeks, 1);
  assert.equal(profile.stats.recentMinutesTwoWeeks, 30);
});

test('perfil inclui conquistas e personalização de foto/header via R2 sanitizada', () => {
  const sampleAvatarUrl = '/api/media/profiles/user_123/avatar-1730350000000.webp';
  const now = Date.parse('2026-10-31T12:00:00Z');
  const state = {
    ...fixture(),
    profile: {
      bio: 'Estudando Direito Processual\nFoco em projetos',
      avatar: sampleAvatarUrl,
      header: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    },
    progress: [
      { id: 'step:s1', materialId: 'c1', unitId: 's1', title: 'Aula 1', materialTitle: 'Curso de redes', type: 'completion', origin: 'manual', historical: false, at: '2026-10-29T15:00:00Z' },
    ],
  };
  const restored = restoreState(JSON.stringify(state));
  assert.equal(restored.profile.avatar, sampleAvatarUrl);
  assert.equal(restored.profile.header, '', 'base64 não é guardado no estado');
  assert.equal(restored.profile.bio, 'Estudando Direito Processual\nFoco em projetos');

  const profile = buildProfile(restored, { now });
  assert.equal(profile.customization.avatar, sampleAvatarUrl);
  assert.equal(profile.customization.header, '');
  assert.ok(profile.achievements.length > 0);
  assert.equal(profile.activity[0].title, 'Curso de redes');
  assert.equal(profile.stats.recentStepsTwoWeeks, 1);
});

test('armazenamento de mídia valida assinatura binária, substitui objeto antigo no R2 e remove ao limpar', async () => {
  const objects = new Map();
  const fakeBucket = {
    async put(key, bytes, contentType) { objects.set(key, { bytes, contentType }); },
    async get(key) { return objects.get(key) || null; },
    async delete(key) { objects.delete(key); },
    async listKeys(prefix) { return [...objects.keys()].filter(key => key.startsWith(prefix)); },
  };
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82]);
  assert.deepEqual(detectImageType(pngBytes), { contentType: 'image/png', ext: 'png' });

  const first = await uploadProfileObject(fakeBucket, { ownerId: 'ana_1', slot: 'avatar', bytes: pngBytes, now: 1000 });
  assert.equal(first.url, '/api/media/profiles/ana_1/avatar-1000.png');
  assert.equal(objects.size, 1);

  const second = await uploadProfileObject(fakeBucket, { ownerId: 'ana_1', slot: 'avatar', bytes: pngBytes, now: 2000 });
  assert.equal(second.url, '/api/media/profiles/ana_1/avatar-2000.png');
  assert.equal(objects.size, 1, 'objeto anterior do mesmo slot foi removido');
  assert.equal(objects.has('profiles/ana_1/avatar-1000.png'), false);

  const parsed = parseMediaKeyFromPath(second.url);
  assert.equal(parsed?.key, 'profiles/ana_1/avatar-2000.png');
  assert.equal(parsed?.contentType, 'image/png');
  assert.equal(parseMediaKeyFromPath('/api/media/profiles/../secret.png'), null);

  await deleteProfileObject(fakeBucket, { ownerId: 'ana_1', slot: 'avatar' });
  assert.equal(objects.size, 0);

  await assert.rejects(
    () => uploadProfileObject(fakeBucket, { ownerId: 'ana_1', slot: 'avatar', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }),
    (error) => error instanceof MediaError && error.code === 'unsupported_format',
  );
});

test('perfil não carrega e-mail, links nem senha', () => {
  const serialized = JSON.stringify(buildProfile(fixture()));
  assert.equal(serialized.includes('@'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('password'), false);
});

test('escolhas ausentes voltam ao padrão compartilhado', () => {
  assert.deepEqual(normalizeSharing(undefined), { library: true, queue: true, progress: true, xp: true, public: true });
  assert.deepEqual(normalizeSharing({ xp: false }), { library: true, queue: true, progress: true, xp: false, public: true });
});

test('restauração preserva as chaves antigas nos dados, por compatibilidade', () => {
  const state = restoreState(fixture());
  state.preferences.sharing = { library: false, queue: true, progress: false, xp: true, public: true };
  const restored = restoreState(JSON.stringify(state));
  assert.deepEqual(restored.preferences.sharing, { library: false, queue: true, progress: false, xp: true, public: true });
  assert.deepEqual(restored.preferences.privacy, state.preferences.privacy, 'privacidade nova não é recalculada das chaves antigas');
});
