// Denúncias. Quem denuncia escolhe um motivo e, se quiser, envia junto uma cópia
// das últimas mensagens; tudo vai para a conta criadora do Lume. A pessoa
// denunciada não é avisada e quem denunciou não aparece para ela.
import { AppError } from '../errors.js';
import { socialText } from '../../public/social-domain.js';
import {
  REPORT_CONTEXTS, REPORT_DETAILS_LIMIT, REPORT_EVIDENCE_MESSAGES, REPORT_EVIDENCE_TEXT, REPORT_REASONS, REPORT_STATUS,
} from '../../public/report-domain.js';

export class ReportError extends AppError {
  constructor(message, code = 'report_error', status = 400) { super(message, code, status); }
}

const iso = (now) => new Date(now).toISOString();
const clip = (value) => String(value ?? '').slice(0, REPORT_EVIDENCE_TEXT);

function idOf(value, label = 'Identificador inválido.') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new ReportError(label, 'invalid_id');
  return value;
}

async function personName(db, id) {
  return (await db.first('SELECT name FROM users WHERE id = ?', [id]))?.name || 'Pessoa';
}

// Cópia do que sustenta a denúncia, no momento em que ela é feita.
async function collectEvidence(db, reporterId, input, includeContext) {
  const { context, targetId, groupId, subjectId } = input;
  if (context === 'direct') {
    const friend = await db.first('SELECT 1 AS ok FROM friendships WHERE user_id = ? AND friend_id = ?', [reporterId, targetId]);
    if (!friend) throw new ReportError('Só é possível denunciar pessoas da sua lista de amigos nesta conversa.', 'not_friends', 403);
    if (!includeContext) return [];
    const rows = await db.all(
      `SELECT sender_id, body, created_at FROM direct_messages
        WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at DESC, id DESC LIMIT ?`,
      [reporterId, targetId, targetId, reporterId, REPORT_EVIDENCE_MESSAGES],
    );
    const names = { [reporterId]: 'Quem denunciou', [targetId]: await personName(db, targetId) };
    return rows.reverse().map((row) => ({ at: row.created_at, from: names[row.sender_id], body: clip(row.body) }));
  }
  if (context === 'group') {
    const id = idOf(groupId, 'Grupo inválido.');
    const members = await db.all('SELECT user_id FROM chat_group_members WHERE group_id = ? AND user_id IN (?, ?)', [id, reporterId, targetId]);
    if (members.length !== 2) throw new ReportError('Grupo não encontrado.', 'group_not_found', 404);
    if (!includeContext) return [];
    const rows = await db.all(
      `SELECT sender_id, body, created_at FROM chat_group_messages
        WHERE group_id = ? AND kind = 'text' AND sender_id = ? ${subjectId ? 'AND id = ?' : ''}
        ORDER BY created_at DESC, id DESC LIMIT ?`,
      [id, targetId, ...(subjectId ? [idOf(subjectId)] : []), REPORT_EVIDENCE_MESSAGES],
    );
    const name = await personName(db, targetId);
    return rows.reverse().map((row) => ({ at: row.created_at, from: name, body: clip(row.body) }));
  }
  // Publicação do feed: a pessoa precisa conseguir ver a publicação.
  const post = await db.first(
    `SELECT p.id, p.body, p.created_at, p.user_id FROM social_posts p
      WHERE p.id = ? AND p.ready = 1 AND p.user_id = ?
        AND EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = ? AND f.friend_id = p.user_id)`,
    [idOf(subjectId, 'Publicação inválida.'), targetId, reporterId],
  );
  if (!post) throw new ReportError('Publicação não encontrada.', 'post_not_found', 404);
  return includeContext ? [{ at: post.created_at, from: await personName(db, targetId), body: clip(post.body) }] : [];
}

export async function createReport(db, reporterId, input = {}, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ReportError('Denúncia inválida.', 'invalid_report');
  const context = input.context;
  if (!REPORT_CONTEXTS.includes(context)) throw new ReportError('Denúncia inválida.', 'invalid_report');
  if (!Object.hasOwn(REPORT_REASONS, input.reason)) throw new ReportError('Escolha o motivo da denúncia.', 'invalid_reason');
  const targetId = idOf(input.targetId, 'Pessoa inválida.');
  if (targetId === reporterId) throw new ReportError('Você não pode denunciar a si mesma.', 'invalid_report');
  const target = await db.first('SELECT 1 AS ok FROM users WHERE id = ?', [targetId]);
  if (!target) throw new ReportError('Pessoa não encontrada.', 'not_found', 404);
  const details = socialText(input.details);
  if (details.length > REPORT_DETAILS_LIMIT) throw new ReportError(`Use até ${REPORT_DETAILS_LIMIT} caracteres nos detalhes.`, 'text_too_long');
  const scope = { context, targetId, groupId: input.groupId || null, subjectId: input.subjectId ? idOf(input.subjectId) : null };
  const evidence = await collectEvidence(db, reporterId, scope, input.includeContext !== false);

  // Repetir a mesma denúncia no mesmo dia não cria outra.
  const since = iso(now - 24 * 3600000);
  const existing = await db.first(
    `SELECT id FROM reports WHERE reporter_id = ? AND target_id = ? AND context = ? AND COALESCE(group_id, '') = ? AND COALESCE(subject_id, '') = ?
        AND status = 'open' AND created_at >= ?`,
    [reporterId, targetId, context, scope.groupId || '', scope.subjectId || '', since],
  );
  if (existing) return { id: existing.id, duplicate: true };
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO reports (id, reporter_id, target_id, context, group_id, subject_id, reason, details, evidence, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [id, reporterId, targetId, context, scope.groupId, scope.subjectId, input.reason, details, JSON.stringify(evidence), iso(now)],
  );
  return { id, duplicate: false };
}

function view(row) {
  let evidence = [];
  try { evidence = JSON.parse(row.evidence || '[]'); } catch { /* cópia ilegível: segue sem ela */ }
  return {
    id: row.id,
    context: row.context,
    reason: row.reason,
    reasonLabel: REPORT_REASONS[row.reason] || row.reason,
    details: row.details,
    evidence,
    status: row.status,
    statusLabel: REPORT_STATUS[row.status] || row.status,
    at: row.created_at,
    reviewedAt: row.reviewed_at || null,
    reporter: { id: row.reporter_id, name: row.reporter_name },
    target: { id: row.target_id, name: row.target_name, reportsAgainst: Number(row.against || 0) },
  };
}

export async function listReports(db, { status = 'open' } = {}) {
  const filter = Object.hasOwn(REPORT_STATUS, status) ? status : 'open';
  const rows = await db.all(
    `SELECT r.*, ru.name AS reporter_name, tu.name AS target_name,
            (SELECT COUNT(*) FROM reports x WHERE x.target_id = r.target_id) AS against
       FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN users tu ON tu.id = r.target_id
      WHERE r.status = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
    [filter],
  );
  const open = await db.first("SELECT COUNT(*) AS total FROM reports WHERE status = 'open'");
  return { reports: rows.map(view), open: Number(open?.total || 0) };
}

export async function reviewReport(db, reviewerId, reportId, status, now = Date.now()) {
  if (!['reviewed', 'dismissed', 'open'].includes(status)) throw new ReportError('Situação inválida.', 'invalid_status');
  const changed = await db.run(
    'UPDATE reports SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?',
    [status, status === 'open' ? null : iso(now), status === 'open' ? null : reviewerId, idOf(reportId)],
  );
  if (!changed) throw new ReportError('Denúncia não encontrada.', 'not_found', 404);
  return { id: reportId, status };
}
