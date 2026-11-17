// Sessão por cookie e limite de tentativas, sobre o adaptador de banco
// ({ run, first, all, batch }) — o mesmo código no SQLite local e no D1.

import { SESSION_TTL_MS, createSessionToken, hashSessionToken, parseCookies } from './domain/auth.js';
import { ATTEMPT_CLEANUP_MS, ATTEMPT_WINDOW_MS } from './config.js';

export function sessionTokenFrom(request) {
  return parseCookies(request.headers.get('Cookie')).lume_session || '';
}

export async function currentUser(db, request, now = Date.now()) {
  const token = sessionTokenFrom(request);
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  // Sessão e conta numa consulta: no D1 cada consulta é uma ida à rede, e esta
  // roda em toda requisição autenticada.
  const row = await db.first(
    `SELECT s.expires_at, u.id, u.name, u.email, u.created_at
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [tokenHash],
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }
  if (!row.id) return null;
  return { id: row.id, name: row.name, email: row.email, created_at: row.created_at };
}

export async function startSession(db, userId, now = Date.now()) {
  const { token, tokenHash } = await createSessionToken();
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [tokenHash, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()],
  );
  return token;
}

export function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

// Janela fixa por chave. A limpeza das chaves antigas é amostrada para não
// custar uma escrita extra em toda requisição.
export async function tooManyAttempts(db, key, limit, now = Date.now()) {
  const windowStart = now - ATTEMPT_WINDOW_MS;
  // Grava e lê o contador na mesma instrução (RETURNING), uma ida ao banco.
  const row = await db.first(
    `INSERT INTO rate_limits (key, count, started_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN started_at < ? THEN 1 ELSE count + 1 END,
       started_at = CASE WHEN started_at < ? THEN ? ELSE started_at END
     RETURNING count`,
    [key, now, windowStart, windowStart, now],
  );
  if (Math.random() < 0.05) {
    await db.run('DELETE FROM rate_limits WHERE started_at < ?', [now - ATTEMPT_CLEANUP_MS]);
  }
  return (row?.count ?? 0) > limit;
}
