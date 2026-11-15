-- Grupos de conversa entre amigos e denúncias. Mensagens de grupo, como as
-- diretas, não geram XP. Denúncias vão para a conta criadora do Lume.

CREATE TABLE chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE chat_group_members (
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX chat_group_members_user ON chat_group_members(user_id);

-- kind: 'text' (mensagem de uma pessoa) ou 'system' (entrou, saiu, renomeou).
CREATE TABLE chat_group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  reference TEXT,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  created_at TEXT NOT NULL
);
CREATE INDEX chat_group_messages_group ON chat_group_messages(group_id, created_at, id);

-- Denúncias. `evidence` guarda uma cópia das mensagens (ou do texto) no momento
-- da denúncia, para a análise não depender de o conteúdo continuar existindo.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context TEXT NOT NULL CHECK (context IN ('direct', 'group', 'post')),
  group_id TEXT,
  subject_id TEXT,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT
);
CREATE INDEX reports_status ON reports(status, created_at DESC);
CREATE INDEX reports_target ON reports(target_id);
