-- Conversas unificadas (17/11/2026): mensagens diretas e grupos passam a usar um
-- só modelo. As tabelas antigas (direct_messages, chat_groups, chat_group_members,
-- chat_group_messages, message_reactions, conversation_mutes) ficam como arquivo:
-- esta migração só copia, não altera nem apaga nada delas.
--
-- Custo no D1 (cada índice conta como linha gravada):
-- - o id da mensagem é ordenável (13 dígitos de milissegundos + '-' + uuid) e a
--   tabela é WITHOUT ROWID, então uma mensagem grava uma linha só e o id serve de
--   cursor de página e de marca de leitura;
-- - a leitura é por pessoa na conversa (last_read_id), uma linha por abertura.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  -- Conversa direta: 'idMenor|idMaior'. Grupo: NULL.
  pair_key TEXT UNIQUE,
  name TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  -- Tudo com id menor ou igual a este cursor já foi lido por esta pessoa.
  last_read_id TEXT NOT NULL DEFAULT '',
  last_read_at TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
) WITHOUT ROWID;
CREATE INDEX conversation_members_user ON conversation_members(user_id);

-- kind: 'text' (mensagem de uma pessoa) ou 'system' (entrou, saiu, renomeou).
CREATE TABLE conversation_messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  body TEXT NOT NULL,
  reference TEXT,
  gif_url TEXT,
  reply_to TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, id)
) WITHOUT ROWID;

CREATE TABLE conversation_reactions (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, message_id, user_id, emoji)
) WITHOUT ROWID;

-- ---------------------------------------------------------------------------
-- Cópia das conversas diretas.
-- ---------------------------------------------------------------------------

INSERT INTO conversations (id, kind, pair_key, name, owner_id, created_at)
SELECT lower(hex(randomblob(16))), 'direct', pair_key, NULL, NULL, MIN(created_at)
  FROM (SELECT CASE WHEN sender_id < recipient_id THEN sender_id || '|' || recipient_id ELSE recipient_id || '|' || sender_id END AS pair_key, created_at
          FROM direct_messages)
 GROUP BY pair_key;

-- Conversa silenciada que ainda não tinha mensagem.
INSERT OR IGNORE INTO conversations (id, kind, pair_key, name, owner_id, created_at)
SELECT lower(hex(randomblob(16))), 'direct',
       CASE WHEN x.user_id < x.target_id THEN x.user_id || '|' || x.target_id ELSE x.target_id || '|' || x.user_id END,
       NULL, NULL, x.created_at
  FROM conversation_mutes x
 WHERE x.scope = 'direct' AND x.user_id <> x.target_id AND EXISTS (SELECT 1 FROM users u WHERE u.id = x.target_id);

-- Duas pessoas por conversa. A marca de leitura fica logo antes da primeira
-- mensagem recebida e ainda não lida; sem nenhuma pendente, na última mensagem.
INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_id, last_read_at, muted)
SELECT p.id, p.me, p.created_at,
       COALESCE(
         (SELECT printf('%013d', pending.first) || '-'
            FROM (SELECT MIN(strftime('%s', m.created_at) * 1000 + CAST(substr(m.created_at, 21, 3) AS INTEGER)) AS first
                    FROM direct_messages m WHERE m.sender_id = p.other AND m.recipient_id = p.me AND m.read_at IS NULL) pending
           WHERE pending.first IS NOT NULL),
         (SELECT MAX(printf('%013d', strftime('%s', m.created_at) * 1000 + CAST(substr(m.created_at, 21, 3) AS INTEGER)) || '-' || m.id)
            FROM direct_messages m
           WHERE (m.sender_id = p.me AND m.recipient_id = p.other) OR (m.sender_id = p.other AND m.recipient_id = p.me)),
         ''),
       (SELECT MAX(m.read_at) FROM direct_messages m WHERE m.sender_id = p.other AND m.recipient_id = p.me),
       EXISTS (SELECT 1 FROM conversation_mutes x WHERE x.user_id = p.me AND x.scope = 'direct' AND x.target_id = p.other)
  FROM (SELECT id, created_at, substr(pair_key, 1, instr(pair_key, '|') - 1) AS me, substr(pair_key, instr(pair_key, '|') + 1) AS other
          FROM conversations WHERE kind = 'direct'
        UNION ALL
        SELECT id, created_at, substr(pair_key, instr(pair_key, '|') + 1) AS me, substr(pair_key, 1, instr(pair_key, '|') - 1) AS other
          FROM conversations WHERE kind = 'direct') p
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = p.me);

INSERT INTO conversation_messages (conversation_id, id, sender_id, kind, body, reference, gif_url, reply_to, created_at)
SELECT c.id,
       printf('%013d', strftime('%s', m.created_at) * 1000 + CAST(substr(m.created_at, 21, 3) AS INTEGER)) || '-' || m.id,
       m.sender_id, 'text', m.body, m.reference, m.gif_url,
       (SELECT printf('%013d', strftime('%s', q.created_at) * 1000 + CAST(substr(q.created_at, 21, 3) AS INTEGER)) || '-' || q.id
          FROM direct_messages q WHERE q.id = m.reply_to),
       m.created_at
  FROM direct_messages m
  JOIN conversations c ON c.pair_key = CASE WHEN m.sender_id < m.recipient_id THEN m.sender_id || '|' || m.recipient_id ELSE m.recipient_id || '|' || m.sender_id END;

INSERT INTO conversation_reactions (conversation_id, message_id, user_id, emoji, created_at)
SELECT c.id,
       printf('%013d', strftime('%s', m.created_at) * 1000 + CAST(substr(m.created_at, 21, 3) AS INTEGER)) || '-' || m.id,
       r.user_id, r.emoji, r.created_at
  FROM message_reactions r
  JOIN direct_messages m ON m.id = r.message_id
  JOIN conversations c ON c.pair_key = CASE WHEN m.sender_id < m.recipient_id THEN m.sender_id || '|' || m.recipient_id ELSE m.recipient_id || '|' || m.sender_id END
 WHERE r.scope = 'direct';

-- ---------------------------------------------------------------------------
-- Cópia dos grupos (o id do grupo é o id da conversa).
-- ---------------------------------------------------------------------------

INSERT INTO conversations (id, kind, pair_key, name, owner_id, created_at)
SELECT id, 'group', NULL, name, owner_id, created_at FROM chat_groups;

-- '~' ordena depois de qualquer id daquele milissegundo: vale a regra antiga
-- (mensagem criada depois de last_read_at é não lida).
INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_id, last_read_at, muted)
SELECT g.group_id, g.user_id, g.joined_at,
       printf('%013d', strftime('%s', g.last_read_at) * 1000 + CAST(substr(g.last_read_at, 21, 3) AS INTEGER)) || '~',
       g.last_read_at,
       EXISTS (SELECT 1 FROM conversation_mutes x WHERE x.user_id = g.user_id AND x.scope = 'group' AND x.target_id = g.group_id)
  FROM chat_group_members g;

INSERT INTO conversation_messages (conversation_id, id, sender_id, kind, body, reference, gif_url, reply_to, created_at)
SELECT m.group_id,
       printf('%013d', strftime('%s', m.created_at) * 1000 + CAST(substr(m.created_at, 21, 3) AS INTEGER)) || '-' || m.id,
       m.sender_id, m.kind, m.body, m.reference, m.gif_url,
       (SELECT printf('%013d', strftime('%s', q.created_at) * 1000 + CAST(substr(q.created_at, 21, 3) AS INTEGER)) || '-' || q.id
          FROM chat_group_messages q WHERE q.id = m.reply_to),
       m.created_at
  FROM chat_group_messages m;

INSERT INTO conversation_reactions (conversation_id, message_id, user_id, emoji, created_at)
SELECT m.group_id,
       printf('%013d', strftime('%s', m.created_at) * 1000 + CAST(substr(m.created_at, 21, 3) AS INTEGER)) || '-' || m.id,
       r.user_id, r.emoji, r.created_at
  FROM message_reactions r
  JOIN chat_group_messages m ON m.id = r.message_id
 WHERE r.scope = 'group';
