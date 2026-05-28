import { cleanApiKeyForHttp, getAiSettings } from './aiService.js'

/** Shared rule for all AI interpretation of user text/voice input. */
export const MIXED_LANGUAGE_AI_RULE = [
  'You may receive mixed Polish, English, and Spanish input.',
  'Interpret it semantically by meaning, not by surface language mixing.',
  'Do not reject or misunderstand phrases because languages are mixed.',
  'Preserve the user\'s intended meaning.',
  'Do not copy mixed-language instruction fragments into final outputs unless the user explicitly asks.',
].join(' ')

/**
 * Normalize a to-do task title from mixed-language input.
 * Falls back to raw text if no API key or request fails.
 * @param {string} input
 * @returns {Promise<string>}
 */
export async function normalizeTodoTaskTitle(input) {
  const text = input.trim()
  if (!text) return text

  const key = cleanApiKeyForHttp(getAiSettings().apiKey)
  if (!key) return text

  try {
    const res = await fetch('/api/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-openai-api-key': key,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You normalize to-do task titles from user input.',
              MIXED_LANGUAGE_AI_RULE,
              'Return ONLY valid JSON: {"title":"string"}',
              'Extract the task meaning in clear concise wording.',
              'Strip command words like "add/dodaj/añade" unless they are part of the task.',
              'Example: "dodaj call supplier tomorrow rano" -> "Call supplier tomorrow morning".',
            ].join(' '),
          },
          { role: 'user', content: text },
        ],
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return text
    const content = data?.choices?.[0]?.message?.content
    if (!content) return text
    const parsed = JSON.parse(content)
    const title = String(parsed.title || '').trim()
    return title || text
  } catch {
    return text
  }
}
