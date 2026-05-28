const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'

function resolveOpenAiApiKey(request) {
  const headerKey = request.headers.get('x-openai-api-key') || ''
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  return headerKey.trim() || bearer || (process.env.OPENAI_API_KEY || '').trim()
}

/**
 * @param {{ file: File, model: string, language?: string, apiKey: string }} args
 */
async function callOpenAiTranscription({ file, model, language, apiKey }) {
  const openAiForm = new FormData()
  openAiForm.append('file', file, file.name || 'recording.webm')
  openAiForm.append('model', model)
  if (language) openAiForm.append('language', language)

  return fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: openAiForm,
  })
}

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function transcribeOpenAI(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const apiKey = resolveOpenAiApiKey(request)
  if (!apiKey) {
    return Response.json({ error: 'Please add your OpenAI API key in Settings.' }, { status: 401 })
  }

  let formData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid audio upload.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No audio file received.' }, { status: 400 })
  }

  const languageParam = formData.get('language')
  const forcedLanguage =
    typeof languageParam === 'string' && languageParam && languageParam !== 'auto' ? languageParam : ''

  const model = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'

  let resp = await callOpenAiTranscription({ file, model, language: forcedLanguage || undefined, apiKey })
  if (!resp.ok && forcedLanguage) {
    const detail = await resp.text()
    const detailLower = detail.toLowerCase()
    const languageRejected =
      detailLower.includes('language') ||
      detailLower.includes('unsupported') ||
      detailLower.includes('invalid_request_error')
    if (languageRejected) {
      console.warn('[transcribe] language rejected, retrying with auto-detect')
      resp = await callOpenAiTranscription({ file, model, apiKey })
    } else {
      console.error('[transcribe] OpenAI error', resp.status, detail)
      return Response.json({ error: 'Transcription failed. Try again.' }, { status: 502 })
    }
  }

  if (!resp.ok) {
    const detail = await resp.text()
    console.error('[transcribe] OpenAI error', resp.status, detail)
    return Response.json({ error: 'Transcription failed. Try again.' }, { status: 502 })
  }

  const data = await resp.json()
  const text = typeof data.text === 'string' ? data.text.trim() : ''
  if (!text) {
    return Response.json({ error: 'Empty transcription. Try again.' }, { status: 422 })
  }

  return Response.json({ text })
}
