-- Runs automatically on first Postgres container init.
-- pgvector extension must exist before any vector column is created.
CREATE EXTENSION IF NOT EXISTS vector;
