// Sino de notificações. Lê o que já existe (amizades, comentários e reações nas
// publicações) sem tabela de eventos própria: só o marco "visto até" é gravado.
// Contatos bloqueados não notificam. A colaboração em projetos foi aposentada
// (15/11/2026): convites antigos ficam no banco, mas não notificam mais.
import { AppError } from '../errors.js';
import { sanitizeProfileImage } from '../../public/domain.js';
import { REPORT_REASONS } from '../../public/report-domain.js';
import { LUME_NEWS, NOTIFICATION_LIMIT, NOTIFICATION_WINDOW_DAYS, notificationFeed } from '../../public/notifications-domain.js';

const NOT_BLOCKED = (column) => `NOT EXISTS (SELECT 1 FROM contact_blocks b WHERE b.user_id = ? AND b.blocked_id = ${column})`;

function person(row) {
  return { id: row.person_id, name: row.name, avatar: sanitizeProfileImage(row.avatar) };
}

export async function listNotifications(db, userId, now = Date.now(), { creator = false } = {}) {
  if (!userId) throw new AppError('Entre na sua conta para ver suas notificações.', 'unauthenticated', 401);
  const floor = new Date(now - NOTIFICATION_WINDOW_DAYS * 86400000).toISOString();
  const avatar = `json_extract(d.data, '$.profile.avatar') AS avatar`;
  const [friends, comments, reactions, read, account, reports] = await Promise.all([
    db.all(
      `SELECT f.friend_id AS person_id, u.name, ${avatar}, f.created_at AS at
         FROM friendships f JOIN users u ON u.id = f.friend_id LEFT JOIN account_documents d ON d.user_id = f.friend_id
        WHERE f.user_id = ? AND f.created_at >= ? AND ${NOT_BLOCKED('f.friend_id')}
        ORDER BY f.created_at DESC LIMIT ?`,
      [userId, floor, userId, NOTIFICATION_LIMIT],
    ),
    db.all(
      `SELECT c.id, c.post_id, c.user_id AS person_id, u.name, ${avatar}, c.body, c.created_at AS at
         FROM social_comments c JOIN social_posts p ON p.id = c.post_id
         JOIN users u ON u.id = c.user_id LEFT JOIN account_documents d ON d.user_id = c.user_id
        WHERE p.user_id = ? AND c.user_id <> ? AND c.created_at >= ? AND ${NOT_BLOCKED('c.user_id')}
        ORDER BY c.created_at DESC LIMIT ?`,
      [userId, userId, floor, userId, NOTIFICATION_LIMIT],
    ),
    db.all(
      `SELECT r.post_id, r.user_id AS person_id, u.name, ${avatar}, MIN(r.created_at) AS at
         FROM social_reactions r JOIN social_posts p ON p.id = r.post_id
         JOIN users u ON u.id = r.user_id LEFT JOIN account_documents d ON d.user_id = r.user_id
        WHERE p.user_id = ? AND r.user_id <> ? AND r.created_at >= ? AND ${NOT_BLOCKED('r.user_id')}
        GROUP BY r.post_id, r.user_id
        ORDER BY MIN(r.created_at) DESC LIMIT ?`,
      [userId, userId, floor, userId, NOTIFICATION_LIMIT],
    ),
    db.first('SELECT seen_at FROM notification_reads WHERE user_id = ?', [userId]),
    db.first('SELECT created_at FROM users WHERE id = ?', [userId]),
    // Denúncias abertas só chegam à conta criadora.
    creator ? db.all("SELECT id, reason, created_at AS at FROM reports WHERE status = 'open' AND created_at >= ? ORDER BY created_at DESC LIMIT ?", [floor, NOTIFICATION_LIMIT]) : [],
  ]);
  const items = [
    ...friends.map((row) => ({ id: `friend-${row.person_id}`, kind: 'friend', at: row.at, person: person(row), title: `${row.name} agora é seu amigo`, href: `#perfil?id=${encodeURIComponent(row.person_id)}` })),
    ...comments.map((row) => ({ id: `comment-${row.id}`, kind: 'comment', at: row.at, person: person(row), title: `${row.name} comentou sua publicação`, body: row.body.slice(0, 120), href: '#amigos' })),
    ...reactions.map((row) => ({ id: `reaction-${row.post_id}-${row.person_id}`, kind: 'reaction', at: row.at, person: person(row), title: `${row.name} reagiu à sua publicação`, href: '#amigos' })),
    ...reports.map((row) => ({ id: `report-${row.id}`, kind: 'report', at: row.at, title: 'Nova denúncia para analisar', body: REPORT_REASONS[row.reason] || '', href: '#denuncias' })),
    ...LUME_NEWS.map((news) => ({ id: news.id, at: news.at, title: news.title, body: news.body, area: news.area, kind: 'news', href: `#novidades?id=${encodeURIComponent(news.id)}` })),
  ];
  return notificationFeed(items, { seenAt: read?.seen_at || null, since: account?.created_at || null, now });
}

// O marco só avança: abrir o sino em outra aba com relógio atrasado não
// devolve avisos já vistos.
export async function markNotificationsSeen(db, userId, now = Date.now()) {
  if (!userId) throw new AppError('Entre na sua conta para ver suas notificações.', 'unauthenticated', 401);
  const at = new Date(now).toISOString();
  await db.run(
    `INSERT INTO notification_reads (user_id, seen_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET seen_at = MAX(notification_reads.seen_at, excluded.seen_at)`,
    [userId, at],
  );
  return { seenAt: at, unseen: 0 };
}
