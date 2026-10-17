import { cleanApiKeyForHttp, getAiSettings } from './aiService.js'
import { MIXED_LANGUAGE_AI_RULE } from './aiPrompts.js'
import { DAY_KEYS, getTodayDayKey } from './todoDays.js'

/** @typedef {import('./todoDays.js').DayKey} DayKey */

/**
 * @typedef {object} TranscriptTaskCandidate
 * @property {string} id
 * @property {string} title
 * @property {string} note
 * @property {DayKey} day
 * @property {boolean} selected
 */

/**
 * @param {unknown} value
 * @returns {DayKey | null}
 */
function parseDayKey(value) {
  const d = String(value || '').toLowerCase().trim()
  return DAY_KEYS.includes(/** @type {DayKey} */ (d)) ? /** @type {DayKey} */ (d) : null
}

/**
 * Extract explicit action items from a full transcript. Never auto-runs — caller must invoke.
 * Avoids fabricating dates, owners, or tasks not clearly stated.
 *
 * @param {string} transcript
 * @returns {Promise<TranscriptTaskCandidate[]>}
 */
export async function extractTasksFromTranscript(transcript) {
  const raw = String(transcript || '').trim()
  if (!raw) return []

  const apiKey = cleanApiKeyForHttp(getAiSettings().apiKey)
  if (!apiKey) {
    throw new Error('Please add your OpenAI API key in Settings.')
  }

  const todayKey = getTodayDayKey()
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  const res = await fetch('/api/openai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openai-api-key': apiKey,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You extract ONLY explicit to-do / action items from a meeting or voice-memo transcript.',
            MIXED_LANGUAGE_AI_RULE,
            'Return ONLY valid JSON: {"tasks":[{"title":"string","day":"monday"|...|"sunday"|null,"note":"string"|null}]}',
            'CRITICAL rules:',
            '- Do NOT invent tasks. If nothing actionable is stated, return {"tasks":[]}.',
            '- Do NOT invent owners, assignees, projects, or deadlines that are not clearly said.',
            '- Do NOT invent calendar dates. Only set day when the speaker clearly names a weekday or today/tomorrow (dziś/jutro/hoy/mañana). Otherwise day must be null.',
            '- Keep titles in the original language (Polish stays Polish, Spanish stays Spanish, English stays English). Never translate.',
            '- Titles should be short action phrases, not full quotes.',
            '- note: optional short context in original language, or null.',
            `- Today is ${todayKey} (${todayLabel}). Map tomorrow/jutro/mañana accordingly when explicitly said.`,
            'Ignore greetings, small talk, and vague discussion without a clear ask.',
          ].join(' '),
        },
        { role: 'user', content: raw.slice(0, 120000) },
      ],
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Task extraction failed.')
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content) return []

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }

  const list = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  /** @type {TranscriptTaskCandidate[]} */
  const out = []
  const seen = new Set()

  for (const item of list) {
    const title = String(item?.title || '').trim()
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const day = parseDayKey(item?.day) || todayKey
    out.push({
      id: crypto.randomUUID(),
      title,
      note: item?.note ? String(item.note).trim() : '',
      day,
      selected: true,
    })
  }

  return out
}
