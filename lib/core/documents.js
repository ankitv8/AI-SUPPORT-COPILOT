import { ensureDatabaseSchema, query } from './db.js'

export const DEFAULT_TENANT_ID = 'demo-browser'

export async function createOwnedDocument({ id, userId, title, filename, sizeBytes = 0, tenantId = DEFAULT_TENANT_ID }) {
  await ensureDatabaseSchema()
  const result = await query(
    'INSERT INTO documents (id, user_id, tenant_id, title, filename, size_bytes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, tenant_id AS "tenantId"',
    [id, userId, tenantId, title, filename, sizeBytes],
  )
  return result.rows[0]
}

export async function deleteOwnedDocument({ id, userId, tenantId = DEFAULT_TENANT_ID }) {
  await ensureDatabaseSchema()
  const result = await query('DELETE FROM documents WHERE id = $1 AND user_id = $2 AND tenant_id = $3 RETURNING id', [id, userId, tenantId])
  return Boolean(result.rowCount)
}

export async function getOwnedDocumentIds({ ids, userId, tenantId = DEFAULT_TENANT_ID }) {
  await ensureDatabaseSchema()
  if (!ids?.length) return []
  const result = await query('SELECT id FROM documents WHERE id = ANY($1) AND user_id = $2 AND tenant_id = $3', [ids, userId, tenantId])
  return result.rows.map((row) => row.id)
}
