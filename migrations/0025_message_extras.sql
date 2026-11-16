-- Mensagens (15/11/2026): responder citando, GIF, reações em emoji e silenciar
-- conversa, em conversas diretas e em grupos. Nada disso gera XP.

-- Mensagem citada (mesma conversa) e GIF do Giphy (só o endereço de mídia).
ALTER TABLE direct_messages ADD COLUMN reply_to TEXT;
ALTER TABLE direct_messages ADD COLUMN gif_url TEXT;
ALTER TABLE chat_group_messages ADD COLUMN reply_to TEXT;
ALTER TABLE chat_group_messages ADD COLUMN gif_url TEXT;

-- Reações: uma por pessoa e emoji em cada mensagem. `scope` diz de qual tabela
-- é a mensagem ('direct' ou 'group'); os ids são UUIDs e não se repetem.
CREATE TABLE message_reactions (
  scope TEXT NOT NULL CHECK (scope IN ('direct', 'group')),
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, message_id, user_id, emoji)
);
CREATE INDEX message_reactions_message ON message_reactions(scope, message_id);

-- Conversa silenciada: não soma no contador nem dispara o aviso flutuante. Para
-- conversa direta, `target_id` é a outra pessoa; para grupo, o id do grupo.
CREATE TABLE conversation_mutes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('direct', 'group')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scope, target_id)
);
