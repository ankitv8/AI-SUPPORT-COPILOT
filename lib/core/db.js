import pg from 'pg'

const { Pool } = pg
let pool

export function createRetryableTask(task) {
  let promise
  return function runTask() {
    if (!promise) {
      promise = Promise.resolve()
        .then(task)
        .catch((error) => {
          promise = null
          throw error
        })
    }
    return promise
  }
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseConnectionString())
}

export function getDatabaseConnectionString() {
  return process.env.DATABASE_POSTGRES_PRISMA_URL || process.env.DATABASE_URL || ''
}

export function isDatabaseConnectionError(error) {
  const pending = [error]
  const visited = new Set()
  const connectionCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EAI_AGAIN',
  ])

  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    if (connectionCodes.has(current.code)) return true
    if (Array.isArray(current.errors)) pending.push(...current.errors)
    if (current.cause) pending.push(current.cause)
  }
  return false
}

function getPool() {
  if (!pool) {
    const connectionString = getDatabaseConnectionString()
    if (!connectionString) throw new Error('DATABASE_URL is not configured')
    pool = new Pool({ connectionString, max: 5, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  }
  return pool
}

export async function query(text, values) {
  return getPool().query(text, values)
}

export function createAdvisoryLockManager(connect) {
  return async function tryAcquireAdvisoryLock(key) {
    const client = await connect()
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [key],
      )
      if (!result.rows[0]?.acquired) {
        client.release()
        return null
      }

      let released = false
      return async () => {
        if (released) return
        released = true
        try {
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [key],
          )
        } catch (error) {
          client.release(error)
          throw error
        }
        client.release()
      }
    } catch (error) {
      client.release(error)
      throw error
    }
  }
}

export const tryAcquireAdvisoryLock = createAdvisoryLockManager(() => getPool().connect())

const ensureSchema = createRetryableTask(() =>
  query(`
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
    `),
)

export async function ensureDatabaseSchema() {
  if (!isDatabaseConfigured()) return
  await ensureSchema()
}
