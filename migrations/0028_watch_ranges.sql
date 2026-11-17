-- Reunir trechos distintos da mesma aula assistidos em visitas diferentes.
ALTER TABLE watch_progress ADD COLUMN ranges_json TEXT NOT NULL DEFAULT '[]';
