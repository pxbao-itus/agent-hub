-- Chạy tự động khi container Postgres khởi tạo lần đầu.
-- pgvector cần extension này trước khi tạo cột vector.
CREATE EXTENSION IF NOT EXISTS vector;
