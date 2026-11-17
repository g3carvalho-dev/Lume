-- Perfil (16/11/2026): uma publicação fixada por pessoa, mostrada no topo das abas
-- Atividade e Publicações do perfil. Fixar outra troca a anterior (chave por pessoa).
-- Excluir a publicação apaga a fixação. Não gera XP.
CREATE TABLE profile_pins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  pinned_at TEXT NOT NULL
);

