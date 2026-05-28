const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

function resolveOpenAiApiKey(request) {
  const headerKey = request.headers.get('x-openai-api-key') || ''
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  return headerKey.trim() || bearer || (process.env.OPENAI_API_KEY || '').trim()
}

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function proxyOpenAiChat(request) {
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

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const resp = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const msg = data?.error?.message || 'OpenAI request failed.'
    return Response.json({ error: msg }, { status: resp.status || 502 })
  }

  return Response.json(data)
}
