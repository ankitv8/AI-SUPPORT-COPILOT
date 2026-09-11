import crypto from 'node:crypto'
import { ensureDatabaseSchema, isDatabaseConfigured, query } from './db.js'

export const AUTH_COOKIE = 'support-copilot-session'
const SESSION_DAYS = 30

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function cookieHeader(token, maxAge = SESSION_DAYS * 86400) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}

function readToken(request) {
  const match = (request.headers.get('cookie') || '').match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  return match?.[1] || null
}

export function hasAuthDatabase() {
  return isDatabaseConfigured()
}

export function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

export async function registerUser(email, password) {
  await ensureDatabaseSchema()
  const normalizedEmail = email.trim().toLowerCase()
  const salt = crypto.randomBytes(16).toString('hex')
  const id = crypto.randomUUID()
  const result = await query(
    'INSERT INTO users (id, email, password_hash, password_salt) VALUES ($1, $2, $3, $4) RETURNING id, email',
    [id, normalizedEmail, passwordHash(password, salt), salt],
  )
  return result.rows[0]
}

export async function createSession(userId) {
  await ensureDatabaseSchema()
  const token = crypto.randomBytes(32).toString('base64url')
  await query(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL \'30 days\')',
    [crypto.randomUUID(), userId, hash(token)],
  )
  return token
}

export async function authenticateUser(email, password) {
  await ensureDatabaseSchema()
  const result = await query('SELECT id, email, password_hash, password_salt FROM users WHERE email = $1', [email.trim().toLowerCase()])
  const user = result.rows[0]
  if (!user || passwordHash(password, user.password_salt) !== user.password_hash) return null
  return { id: user.id, email: user.email }
}

export async function getUserFromRequest(request) {
  if (!isDatabaseConfigured()) return null
  await ensureDatabaseSchema()
  const token = readToken(request)
  if (!token) return null
  const result = await query(
    'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()',
    [hash(token)],
  )
  return result.rows[0] || null
}

export async function destroySession(request) {
  if (!isDatabaseConfigured()) return
  const token = readToken(request)
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)])
}

export function withSession(response, token) {
  response.headers.append('Set-Cookie', cookieHeader(token))
  return response
}

export function clearSession(response) {
  response.headers.append('Set-Cookie', cookieHeader('', 0))
  return response
}
