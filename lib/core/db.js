import pg from 'pg'

const { Pool } = pg
let pool
let schemaPromise

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL)
}

function getPool() {
  if (!pool) {
    if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured')
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  }
  return pool
}

export async function query(text, values) {
  return getPool().query(text, values)
}

export async function ensureDatabaseSchema() {
  if (!isDatabaseConfigured()) return
  if (!schemaPromise) {
    schemaPromise = query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL DEFAULT 'demo-browser',
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
      CREATE TABLE IF NOT EXISTS user_usage (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
  }
  await schemaPromise
}
