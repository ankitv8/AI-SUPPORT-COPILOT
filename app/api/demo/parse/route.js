import { isDemoEnabled } from '../../../../platform/demo/index.js'
import { parseUploadedFile } from '../../../../lib/knowledge/documentParser.js'
import { MAX_UPLOAD_BYTES } from '../../../../lib/knowledge/documentTypes.js'
import { checkApiRateLimit } from '../../../../lib/core/apiRateLimit.js'
import { checkApiTokenBudget } from '../../../../lib/core/apiBudget.js'
import { requireAuthenticatedUser } from '../../../../lib/core/auth.js'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  const { user, response } = await requireAuthenticatedUser(request)
  if (response) return response
  const budgetLimit = await checkApiTokenBudget(user)
  if (budgetLimit) return budgetLimit
  if (!isDemoEnabled()) return Response.json({ error: 'Demo is disabled.' }, { status: 404 })

  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return Response.json({ error: 'file is required' }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'File is too large (max 5 MB).' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseUploadedFile({
      buffer,
      filename: file.name || 'upload.txt',
      mimeType: file.type || '',
    })

    return Response.json({
      ok: true,
      title: parsed.title,
      text: parsed.text,
      filename: file.name,
      sizeBytes: file.size,
    })
  } catch (error) {
    console.error('[document-parse] failed', error)
    return Response.json({ error: "Couldn't process this file, please try again." }, { status: 400 })
  }
}
