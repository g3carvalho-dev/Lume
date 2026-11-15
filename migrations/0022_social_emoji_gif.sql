-- Social: reações com vários emojis (em publicações e comentários), respostas
-- em comentários e GIFs. Nada disso gera XP.

-- A tabela de reações passa a aceitar um emoji por pessoa e publicação;
-- as curtidas antigas viram ❤️.
CREATE TABLE social_reactions_v2 (
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '❤️',
  PRIMARY KEY(post_id, user_id, emoji)
);
INSERT INTO social_reactions_v2 (post_id, user_id, created_at, emoji)
  SELECT post_id, user_id, created_at, '❤️' FROM social_reactions;
DROP TABLE social_reactions;
ALTER TABLE social_reactions_v2 RENAME TO social_reactions;

CREATE TABLE social_comment_reactions (
  comment_id TEXT NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(comment_id, user_id, emoji)
);

-- Resposta a um comentário (um nível) e GIF anexado por endereço validado.
ALTER TABLE social_comments ADD COLUMN parent_id TEXT REFERENCES social_comments(id) ON DELETE CASCADE;
ALTER TABLE social_comments ADD COLUMN gif_url TEXT;
CREATE INDEX social_comments_parent ON social_comments(parent_id);
ALTER TABLE social_posts ADD COLUMN gif_url TEXT;
