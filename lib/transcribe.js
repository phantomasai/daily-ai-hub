const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'

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

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'Transcription not configured on server.' }, { status: 503 })
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
  const language =
    typeof languageParam === 'string' && languageParam && languageParam !== 'auto'
      ? languageParam
      : 'pl'

  const model = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'

  const openAiForm = new FormData()
  openAiForm.append('file', file, file.name || 'recording.webm')
  openAiForm.append('model', model)
  openAiForm.append('language', language)

  const resp = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: openAiForm,
  })

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
