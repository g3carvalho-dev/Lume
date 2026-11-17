// Amizades por convite.
//
// Decisões de privacidade:
// - não existe busca por e-mail: criar conta no Lume não fica descobrível;
// - o convite é um código que a pessoa compartilha como quiser: vale por 7 dias
//   e pode ser aceito por várias pessoas, sempre limitado ao prazo;
// - a amizade, sozinha, não expõe biblioteca, progresso ou XP: o perfil usa as
//   escolhas de compartilhamento de cada pessoa;
// - convidar, aceitar ou remover não concedem XP.

import { hashSessionToken } from './auth.js';
import { AppError } from '../errors.js';
import { createInitialState, restoreState, sanitizeProfileImage } from '../../public/domain.js';
import { buildProfile } from '../../public/profile-domain.js';
import { normalizePrivacy, profileAccess } from '../../public/privacy-domain.js';
import { STALE_SESSION_MS } from '../../public/session-domain.js';
import { PRESENCE_TTL_MS, cleanAppLabel } from '../../companion/domain.mjs';
import { getXpSnapshot } from './xp.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_CODE_LENGTH = 12;
export const MAX_FRIENDS = 200;
export const ONLINE_PRESENCE_TTL_MS = 3 * 60 * 1000;
const STUDY_COMPANION_CATEGORIES = new Set(['study', 'reading', 'project']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class FriendsError extends AppError {
  constructor(message, code = 'friends_error', status = 400) {
    super(message, code, status);
    this.name = 'FriendsError';
  }
}

function iso(now) {
  return new Date(now).toISOString();
}

export function generateInviteCode(randomValues = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH))) {
  let code = '';
  for (const byte of randomValues) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function normalizeInviteCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatInviteCode(code) {
  return normalizeInviteCode(code).match(/.{1,4}/g)?.join('-') || '';
}

export async function createInvite(db, userId, now = Date.now()) {
  if (!userId) throw new FriendsError('Entre na sua conta para convidar alguém.', 'unauthenticated', 401);
  const code = generateInviteCode();
  const codeHash = await hashSessionToken(normalizeInviteCode(code));
  // Um convite válido por vez: o último gerado é o que vale, para não deixar
  // códigos esquecidos circulando. Os já expirados ficam no histórico.
  await db.run('DELETE FROM friend_invites WHERE user_id = ? AND expires_at > ?', [userId, iso(now)]);
  await db.run(
    'INSERT INTO friend_invites (code_hash, user_id, created_at, expires_at, used_at, used_by) VALUES (?, ?, ?, ?, NULL, NULL)',
    [codeHash, userId, iso(now), iso(now + INVITE_TTL_MS)],
  );
  return { code: formatInviteCode(code), expiresAt: iso(now + INVITE_TTL_MS), ttlSeconds: Math.round(INVITE_TTL_MS / 1000) };
}

export async function acceptInvite(db, userId, rawCode, now = Date.now()) {
  if (!userId) throw new FriendsError('Entre na sua conta para aceitar o convite.', 'unauthenticated', 401);
  const code = normalizeInviteCode(rawCode);
  if (code.length !== INVITE_CODE_LENGTH) {
    throw new FriendsError('O convite tem 12 caracteres. Confira e tente de novo.', 'invalid_code', 400);
  }
  const codeHash = await hashSessionToken(code);
  const invite = await db.first('SELECT user_id, expires_at FROM friend_invites WHERE code_hash = ?', [codeHash]);
  if (!invite) throw new FriendsError('Convite não encontrado. Peça um novo link a quem convidou.', 'invalid_code', 400);
  if (Date.parse(invite.expires_at) <= now) throw new FriendsError('Este convite expirou. Peça outro.', 'expired_code', 400);
  if (invite.user_id === userId) throw new FriendsError('Você não pode aceitar o seu próprio convite.', 'self_invite', 400);

  const count = await db.first('SELECT COUNT(*) AS total FROM friendships WHERE user_id = ?', [userId]);
  if (Number(count?.total ?? 0) >= MAX_FRIENDS) {
    throw new FriendsError(`Sua lista já tem ${MAX_FRIENDS} amigos.`, 'friend_limit', 409);
  }

  const existing = await db.first('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', [userId, invite.user_id]);
  if (existing) {
    return { alreadyFriends: true, friend: await publicFriend(db, invite.user_id), friendId: invite.user_id };
  }

  // O convite vale até expirar: cada pessoa é registrada uma vez em
  // friend_invite_uses, para contar quantos entraram por ele. O INSERT OR IGNORE
  // mantém a operação repetível sem duplicar o registro.
  await db.run(
    'INSERT OR IGNORE INTO friend_invite_uses (code_hash, user_id, used_at) VALUES (?, ?, ?)',
    [codeHash, userId, iso(now)],
  );

  await db.run('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)', [userId, invite.user_id, iso(now)]);
  await db.run('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)', [invite.user_id, userId, iso(now)]);

  return { alreadyFriends: false, friend: await publicFriend(db, invite.user_id), friendId: invite.user_id };
}

async function publicFriend(db, userId) {
  const row = await db.first('SELECT id, name FROM users WHERE id = ?', [userId]);
  return row ? { id: row.id, name: row.name } : { id: userId, name: 'Pessoa do Lume' };
}

function parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function touchUserPresence(db, userId, now = Date.now()) {
  if (!userId) return;
  await db.run(
    `INSERT INTO user_presence (user_id, last_seen_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [userId, iso(now)],
  );
}

export async function clearUserPresence(db, userId) {
  if (!userId) return;
  await db.run('DELETE FROM user_presence WHERE user_id = ?', [userId]);
}

async function resolveStudyingTopic(db, userId, activeSession, allowTopic) {
  if (!allowTopic) return '';
  if (activeSession.courseId) {
    const matRow = await db.first(
      'SELECT data FROM materials WHERE user_id = ? AND id = ?',
      [userId, activeSession.courseId],
    );
    const material = parseJson(matRow?.data);
    if (material?.subjectId) {
      const subRow = await db.first(
        'SELECT data FROM study_subjects WHERE user_id = ? AND id = ?',
        [userId, material.subjectId],
      );
      const subjectTitle = cleanAppLabel(parseJson(subRow?.data)?.title);
      if (subjectTitle) return subjectTitle;
    }
    const materialTitle = cleanAppLabel(material?.title);
    if (materialTitle) return materialTitle;
  }
  const label = cleanAppLabel(activeSession.label);
  return label && label !== 'Sessão de estudo' ? label : '';
}

// O tema do estudo (disciplina ou material) só aparece para quem pode ver a Atividade.
async function buildFriendActivity(db, row, companion, now, relation = 'friend') {
  const doc = parseJson(row.account_doc);
  const showTopic = profileAccess(doc?.preferences, relation).sections.activity;
  const session = doc?.activeSession;
  const sessionTick = session?.status === 'active' ? Date.parse(session.lastTickAt) : NaN;
  const sessionActive = Boolean(session?.status === 'active' && Number.isFinite(sessionTick) && now - sessionTick < STALE_SESSION_MS);

  if (sessionActive) {
    const topic = await resolveStudyingTopic(db, row.id, session, showTopic);
    return { active: true, status: 'studying', label: 'Estudando', topic };
  }

  const companionUpdated = companion ? Date.parse(companion.updated_at) : NaN;
  if (Number.isFinite(companionUpdated) && now - companionUpdated < PRESENCE_TTL_MS) {
    if (STUDY_COMPANION_CATEGORIES.has(companion.category)) {
      return {
        active: true,
        status: 'studying',
        label: 'Estudando',
        topic: showTopic ? cleanAppLabel(companion.app) : '',
      };
    }
    return { active: true, status: 'online', label: 'Online', topic: '' };
  }

  const webSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN;
  if (Number.isFinite(webSeen) && now - webSeen < ONLINE_PRESENCE_TTL_MS) {
    return { active: true, status: 'online', label: 'Online', topic: '' };
  }

  return { active: false, status: 'offline', label: 'Offline', topic: '' };
}

export async function listFriends(db, userId, now = Date.now()) {
  if (!userId) throw new FriendsError('Entre na sua conta para ver seus amigos.', 'unauthenticated', 401);
  const friends = await db.all(
    `SELECT u.id, u.name, f.created_at AS since, uh.handle AS handle,
            up.last_seen_at AS last_seen_at,
            ad.data AS account_doc
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       LEFT JOIN user_presence up ON up.user_id = u.id
       LEFT JOIN user_handles uh ON uh.user_id = u.id
       LEFT JOIN account_documents ad ON ad.user_id = u.id
      WHERE f.user_id = ?
      ORDER BY u.name COLLATE NOCASE`,
    [userId],
  );
  const { fillMissingHandles } = await import('./friend-requests.js');
  await fillMissingHandles(db, friends);
  const friendIds = friends.map((row) => row.id);
  const companions = new Map();
  if (friendIds.length) {
    const placeholders = friendIds.map(() => '?').join(', ');
    const rows = await db.all(
      `SELECT user_id, app, category, updated_at
         FROM companion_presence
        WHERE user_id IN (${placeholders})
        ORDER BY updated_at DESC`,
      friendIds,
    );
    for (const row of rows) {
      if (!companions.has(row.user_id)) companions.set(row.user_id, row);
    }
  }
  const friendItems = await Promise.all(friends.map(async (row) => ({
    id: row.id,
    name: row.name,
    handle: row.handle || null,
    avatar: sanitizeProfileImage(parseJson(row.account_doc)?.profile?.avatar),
    since: row.since,
    activity: await buildFriendActivity(db, row, companions.get(row.id) || null, now),
  })));
  const invites = await db.all(
    `SELECT i.created_at, i.expires_at,
            (SELECT COUNT(*) FROM friend_invite_uses u WHERE u.code_hash = i.code_hash) AS uses
       FROM friend_invites i
      WHERE i.user_id = ? ORDER BY i.created_at DESC LIMIT 10`,
    [userId],
  );
  return {
    friends: friendItems,
    invites: invites.map((row) => ({
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: Date.parse(row.expires_at) <= now,
      uses: Number(row.uses ?? 0),
    })),
    maxFriends: MAX_FRIENDS,
  };
}

export async function removeFriend(db, userId, friendId) {
  if (!userId) throw new FriendsError('Entre na sua conta.', 'unauthenticated', 401);
  if (!friendId || typeof friendId !== 'string') throw new FriendsError('Amizade inválida.', 'invalid_friend', 400);
  const exists = await db.first('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', [userId, friendId]);
  if (!exists) throw new FriendsError('Essa pessoa não está na sua lista.', 'not_found', 404);
  await db.run('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [userId, friendId, friendId, userId]);
  return { removed: true, friendId };
}

// Amizade não é compartilhamento: nada da biblioteca é exposto por aqui.
export function friendshipPolicy() {
  return {
    sharesLibrary: false,
    sharesProgress: false,
    grantsXp: false,
    invitesAreSingleUse: false,
    invitesReusableUntilExpiry: true,
    inviteTtlDays: Math.round(INVITE_TTL_MS / 86400000),
  };
}

// Relação de quem pede com a pessoa do perfil: 'self', 'friend', 'member' (conta
// logada sem amizade) ou 'blocked' (bloqueio em qualquer sentido, que nega tudo).
export async function profileRelation(db, viewerId, targetId) {
  if (viewerId && viewerId === targetId) return 'self';
  const [linked, blocked] = await Promise.all([
    db.first('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', [viewerId, targetId]),
    db.first(
      'SELECT 1 AS ok FROM contact_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
      [viewerId, targetId, targetId, viewerId],
    ),
  ]);
  if (blocked) return 'blocked';
  return linked ? 'friend' : 'member';
}

// Acesso de quem pede ao perfil de alguém, conferido no servidor em cada rota
// (perfil, amigos, publicações, anexos e cartão). Perfil que não abre responde 403.
export async function readProfileAccess(db, viewerId, targetId, preferences) {
  const relation = await profileRelation(db, viewerId, targetId);
  let prefs = preferences;
  if (prefs === undefined) {
    const doc = await db.first('SELECT data FROM account_documents WHERE user_id = ?', [targetId]);
    prefs = parseJson(doc?.data)?.preferences;
  }
  const access = profileAccess(prefs, relation);
  if (!access.open) throw new FriendsError('Este perfil é privado. Só amigos podem abri-lo.', 'not_friends', 403);
  return { relation, ...access };
}

// Perfil visto por outra pessoa com conta: nunca expõe o e-mail e passa pelo
// alcance de cada seção (privacy-domain.js). Seção oculta vem vazia, com o aviso
// em `visibility`, e os contadores dela também somem.
export async function readFriendProfile(db, viewerId, friendId) {
  if (!friendId) throw new FriendsError('Perfil não encontrado.', 'not_found', 404);
  const { readStoredLibrary } = await import('./library-store.js');
  // Cada consulta ao D1 é uma ida e volta à rede: as independentes rodam juntas.
  const [target, row, handle, presenceRow, accountDoc, companion] = await Promise.all([
    db.first('SELECT id, name FROM users WHERE id = ?', [friendId]),
    readStoredLibrary(db, friendId),
    db.first('SELECT handle FROM user_handles WHERE user_id = ?', [friendId]),
    db.first('SELECT last_seen_at FROM user_presence WHERE user_id = ?', [friendId]),
    db.first('SELECT data FROM account_documents WHERE user_id = ?', [friendId]),
    db.first('SELECT app, category, updated_at FROM companion_presence WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [friendId]),
  ]);
  if (!target) throw new FriendsError('Perfil não encontrado.', 'not_found', 404);
  const state = row?.state || createInitialState();
  const { relation, sections } = await readProfileAccess(db, viewerId, friendId, state.preferences);
  const validated = sections.achievements ? await validatedProfile(db, friendId) : null;
  return {
    user: { id: target.id, name: target.name, handle: handle?.handle || null },
    viewer: relation === 'friend' ? 'friend' : 'public',
    relation,
    updatedAt: row?.updatedAt ?? null,
    // Mesma regra de presença para todo perfil que abre: Estudando (com o tema, se quem vê pode ver a Atividade), Online ou Offline.
    presence: await buildFriendActivity(
      db,
      { id: friendId, last_seen_at: presenceRow?.last_seen_at ?? null, account_doc: accountDoc?.data ?? null },
      companion || null,
      Date.now(),
      relation,
    ),
    ...buildProfile(state, { validated, relation }),
  };
}

// Publicação fixada no perfil (uma por pessoa), se ainda existe.
export async function pinnedPostId(db, userId) {
  const pin = await db.first(
    'SELECT p.post_id FROM profile_pins p JOIN social_posts s ON s.id = p.post_id AND s.user_id = p.user_id AND s.ready = 1 WHERE p.user_id = ?',
    [userId],
  );
  return pin?.post_id || null;
}

// Amigos de uma pessoa, vistos no bloco Amigos do perfil. Só abre para quem pode
// ver a seção Amigos. Cada amigo listado precisa ser alguém que quem pede poderia
// abrir (a própria conta, amizade em comum ou perfil aberto) e sem bloqueio com
// quem pede: quem fechou o perfil não é exposto por um amigo em comum.
export async function listProfileFriends(db, viewerId, targetId) {
  if (!targetId) throw new FriendsError('Perfil não encontrado.', 'not_found', 404);
  const target = await db.first('SELECT id FROM users WHERE id = ?', [targetId]);
  if (!target) throw new FriendsError('Perfil não encontrado.', 'not_found', 404);
  const { sections } = await readProfileAccess(db, viewerId, targetId);
  if (!sections.friends) return { hidden: true, friends: [], total: null };
  const [rows, mine, blocks] = await Promise.all([
    db.all(
      `SELECT u.id, u.name, uh.handle AS handle, ad.data AS account_doc
         FROM friendships f
         JOIN users u ON u.id = f.friend_id
         LEFT JOIN user_handles uh ON uh.user_id = u.id
         LEFT JOIN account_documents ad ON ad.user_id = u.id
        WHERE f.user_id = ?
        ORDER BY u.name COLLATE NOCASE`,
      [targetId],
    ),
    db.all('SELECT friend_id FROM friendships WHERE user_id = ?', [viewerId]),
    db.all('SELECT user_id, blocked_id FROM contact_blocks WHERE user_id = ? OR blocked_id = ?', [viewerId, viewerId]),
  ]);
  const viewerFriends = new Set(mine.map((item) => item.friend_id));
  const blocked = new Set(blocks.map((item) => (item.user_id === viewerId ? item.blocked_id : item.user_id)));
  const visible = rows.filter((row) => !blocked.has(row.id) && (row.id === viewerId
    || viewerFriends.has(row.id)
    || normalizePrivacy(parseJson(row.account_doc)?.preferences).mode === 'open'));
  const { fillMissingHandles } = await import('./friend-requests.js');
  await fillMissingHandles(db, visible);
  return {
    hidden: false,
    total: visible.length,
    friends: visible.map((row) => ({
      id: row.id,
      name: row.name,
      handle: row.handle || null,
      avatar: sanitizeProfileImage(parseJson(row.account_doc)?.profile?.avatar),
    })),
  };
}

// Resumo validado no servidor (nível e conquistas); ausente se a pessoa não tem XP.
async function validatedProfile(db, userId) {
  try {
    const snapshot = await getXpSnapshot(db, userId, { create: false, withEvents: false });
    return { ...snapshot.summary, achievements: snapshot.achievements, titles: snapshot.titles };
  } catch {
    return null;
  }
}

// Cartão rápido da pessoa (Feed, Ranking, Amigos e Mensagens): foto, nome, @usuário,
// nível e posição no ranking. Abre para quem pode abrir o perfil (a própria pessoa,
// amigos ou, com "Perfil público", qualquer conta sem bloqueio). O nível segue a
// escolha "XP" do perfil; a posição só aparece se a pessoa participa do ranking e
// está no placar de quem pede (amizade ou a própria conta). Sem XP.
export async function readPersonCard(db, viewerId, targetId) {
  if (!targetId) throw new FriendsError('Pessoa não encontrada.', 'not_found', 404);
  const [target, handle, doc, linked, blocked, optIn] = await Promise.all([
    db.first('SELECT id, name FROM users WHERE id = ?', [targetId]),
    db.first('SELECT handle FROM user_handles WHERE user_id = ?', [targetId]),
    db.first('SELECT data FROM account_documents WHERE user_id = ?', [targetId]),
    db.first('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', [viewerId, targetId]),
    db.first(
      'SELECT user_id FROM contact_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
      [viewerId, targetId, targetId, viewerId],
    ),
    db.first('SELECT ranking_opt_in FROM xp_settings WHERE user_id = ?', [targetId]),
  ]);
  if (!target) throw new FriendsError('Pessoa não encontrada.', 'not_found', 404);
  const self = targetId === viewerId;
  const account = parseJson(doc?.data);
  const relation = self ? 'self' : blocked ? 'blocked' : linked ? 'friend' : 'member';
  const access = profileAccess(account?.preferences, relation);
  if (!access.open) throw new FriendsError('Este perfil é privado. Só amigos podem abri-lo.', 'not_friends', 403);
  const validated = access.sections.achievements ? await validatedProfile(db, targetId) : null;
  let ranking = null;
  if (Number(optIn?.ranking_opt_in) === 1 && (self || linked)) {
    const { getRanking } = await import('./xp.js');
    const board = await getRanking(db, viewerId, { tab: 'level' });
    const entry = board.entries.find((item) => item.id === targetId);
    if (entry) ranking = { position: entry.position, participants: board.entries.length };
  }
  return {
    person: { id: target.id, name: target.name, handle: handle?.handle || null, avatar: sanitizeProfileImage(account?.profile?.avatar) },
    relation: self ? 'self' : linked ? 'friend' : 'public',
    level: validated ? validated.level : null,
    ranking,
    canMessage: Boolean(linked && !blocked),
  };
}
