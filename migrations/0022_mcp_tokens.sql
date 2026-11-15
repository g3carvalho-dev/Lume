-- Chave única de acesso MCP por conta (Remote MCP em /api/mcp).
-- Apenas o hash SHA-256 e um prefixo curto para exibição são armazenados.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash);
