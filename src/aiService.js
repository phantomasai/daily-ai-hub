/**
 * AI provider layer: reads `provider` + `apiKey` from localStorage (or overrides).
 * Exports analyzeText / analyzeImage, testConnection, and daily tracker analysis.
 */

import { computeTotalsFromLogItems, getTodayDateKey } from './dailyLogStorage.js'

const PREFIX = 'dailyAiHub_'

export const AI_STORAGE_KEYS = {
  provider: `${PREFIX}provider`,
  apiKey: `${PREFIX}apiKey`,
  language: `${PREFIX}language`,
  autoConfirm: `${PREFIX}autoConfirm`,
  targets: `${PREFIX}targets`,
}

const DEFAULT_TARGETS = {
  calories: 2600,
  protein: 190,
  carbs: 280,
  fats: 80,
}

/** OpenAI: GPT-5.4 (alias); chat uses max_completion_tokens, not max_tokens. */
const OPENAI_MODEL = 'gpt-5.4'
/** Anthropic: Claude Sonnet 4.6 */
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Fetch header values must be ISO-8859-1. Pasted keys often include BOM / zero-width chars (outside Latin-1), which throws.
 */
export function cleanApiKeyForHttp(key) {
  return Array.from(String(key ?? '').replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, ''), (ch) => {
    const c = ch.codePointAt(0)
    return c > 0 && c <= 0xff ? ch : ''
  })
    .join('')
    .trim()
}

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function getAiSettings() {
  if (typeof window === 'undefined') {
    return {
      provider: 'openai',
      apiKey: '',
      language: 'en',
      autoConfirm: false,
      targets: { ...DEFAULT_TARGETS },
    }
  }

  return {
    provider: localStorage.getItem(AI_STORAGE_KEYS.provider) || 'openai',
    apiKey: localStorage.getItem(AI_STORAGE_KEYS.apiKey) || '',
    language: localStorage.getItem(AI_STORAGE_KEYS.language) || 'en',
    autoConfirm: localStorage.getItem(AI_STORAGE_KEYS.autoConfirm) === 'true',
    targets: readJson(AI_STORAGE_KEYS.targets, { ...DEFAULT_TARGETS }),
  }
}

/** Persist provider and API key to localStorage (browser only). */
export function saveAiCredentials({ provider, apiKey }) {
  if (typeof window === 'undefined') return
  if (provider != null) localStorage.setItem(AI_STORAGE_KEYS.provider, provider)
  if (apiKey != null) localStorage.setItem(AI_STORAGE_KEYS.apiKey, cleanApiKeyForHttp(apiKey))
}

/**
 * Same-origin paths proxied by Vite (dev) and Vercel rewrites (production).
 * Avoids browser CORS when calling OpenAI / Anthropic from the SPA.
 */
function openAiBaseUrl() {
  return '/api/openai'
}

function anthropicBaseUrl() {
  return '/__ai/anthropic'
}

function normalizeBase64ToDataUrl(base64) {
  const trimmed = (base64 || '').trim()
  if (trimmed.startsWith('data:')) return trimmed
  return `data:image/jpeg;base64,${trimmed}`
}

function parseNutritionJson(text) {
  const raw = (text || '').trim()
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const parsed = JSON.parse(unfenced)
  return {
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fats: Number(parsed.fats) || 0,
    suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : String(parsed.suggestion ?? ''),
  }
}

function nutritionSystemPrompt() {
  return [
    'You help estimate meal nutrition and give short advice.',
    'Reply with ONLY valid JSON (no markdown) in this exact shape:',
    '{"calories":number,"protein":number,"carbs":number,"fats":number,"suggestion":string}',
    'Numbers are for the described food. suggestion is one short English sentence.',
  ].join(' ')
}

async function openAiChat({ apiKey, messages, responseFormatJson = false, maxCompletionTokens = 500 }) {
  const key = cleanApiKeyForHttp(apiKey)
  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.3,
    max_completion_tokens: maxCompletionTokens,
    reasoning_effort: 'none',
  }
  if (responseFormatJson) body.response_format = { type: 'json_object' }

  const headers = {
    'Content-Type': 'application/json',
  }
  if (key) headers['x-openai-api-key'] = key

  const res = await fetch(`${openAiBaseUrl()}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || 'OpenAI request failed'
    throw new Error(msg)
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return content
}

async function anthropicMessages({ apiKey, model, messages, maxTokens = 500, system }) {
  const key = cleanApiKeyForHttp(apiKey)
  const body = { model, max_tokens: maxTokens, messages }
  if (system != null && system !== '') body.system = system

  const res = await fetch(`${anthropicBaseUrl()}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || 'Anthropic request failed'
    throw new Error(msg)
  }
  const blocks = data?.content
  const text = Array.isArray(blocks) ? blocks.map((b) => (b.type === 'text' ? b.text : '')).join('') : ''
  if (!text) throw new Error('Empty response from Anthropic')
  return text
}

/**
 * Lightweight ping to verify the API key. Uses in-memory credentials if passed.
 * @param {{ provider?: string, apiKey?: string } | null} overrides
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function testConnection(overrides = null) {
  const base = getAiSettings()
  const provider = (overrides?.provider ?? base.provider) || 'openai'
  const apiKey = cleanApiKeyForHttp(overrides?.apiKey ?? base.apiKey)

  if (!apiKey) {
    return { ok: false, message: 'No API key. Enter a key and click Save, or paste it before testing.' }
  }

  try {
    if (provider === 'claude') {
      await anthropicMessages({
        apiKey,
        model: ANTHROPIC_MODEL,
        maxTokens: 32,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      })
      return { ok: true, message: 'Claude API responded successfully.' }
    }

    await openAiChat({
      apiKey,
      responseFormatJson: false,
      maxCompletionTokens: 32,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    })
    return { ok: true, message: 'OpenAI API responded successfully.' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Connection test failed.' }
  }
}

/**
 * @param {string} prompt
 * @returns {Promise<{ calories: number, protein: number, carbs: number, fats: number, suggestion: string }>}
 */
export async function analyzeText(prompt) {
  const { provider, apiKey } = getAiSettings()
  const key = cleanApiKeyForHttp(apiKey)
  if (!key && provider === 'claude') {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      suggestion: 'Add and save an API key in Settings to enable analysis.',
    }
  }

  try {
    let text
    if (provider === 'claude') {
      text = await anthropicMessages({
        apiKey: key,
        model: ANTHROPIC_MODEL,
        maxTokens: 400,
        messages: [
          {
            role: 'user',
            content: `${nutritionSystemPrompt()}\n\nUser input:\n${prompt}`,
          },
        ],
      })
    } else {
      text = await openAiChat({
        apiKey: key,
        responseFormatJson: true,
        maxCompletionTokens: 400,
        messages: [
          { role: 'system', content: nutritionSystemPrompt() },
          { role: 'user', content: prompt },
        ],
      })
    }
    return parseNutritionJson(text)
  } catch (e) {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      suggestion: e instanceof Error ? e.message : 'Analysis failed.',
    }
  }
}

/**
 * @param {string} base64 image bytes or full data URL
 * @param {string} prompt
 * @returns {Promise<{ calories: number, protein: number, carbs: number, fats: number, suggestion: string }>}
 */
export async function analyzeImage(base64, prompt) {
  const { provider, apiKey } = getAiSettings()
  const key = cleanApiKeyForHttp(apiKey)
  if (!key && provider === 'claude') {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      suggestion: 'Add and save an API key in Settings to enable photo analysis.',
    }
  }

  const dataUrl = normalizeBase64ToDataUrl(base64)
  const plainBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const mediaType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'

  try {
    let text
    if (provider === 'claude') {
      text = await anthropicMessages({
        apiKey: key,
        model: ANTHROPIC_MODEL,
        maxTokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: plainBase64 },
              },
              {
                type: 'text',
                text: `${nutritionSystemPrompt()}\n\nContext from user:\n${prompt || 'Estimate this meal.'}`,
              },
            ],
          },
        ],
      })
    } else {
      const headers = {
        'Content-Type': 'application/json',
      }
      if (key) headers['x-openai-api-key'] = key

      const res = await fetch(`${openAiBaseUrl()}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.3,
          max_completion_tokens: 500,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: nutritionSystemPrompt() },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt || 'Estimate calories and macros for this food photo.' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error?.message || data?.message || res.statusText || 'OpenAI request failed'
        throw new Error(msg)
      }
      text = data?.choices?.[0]?.message?.content
      if (!text) throw new Error('Empty response from OpenAI')
    }

    return parseNutritionJson(text)
  } catch (e) {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      suggestion: e instanceof Error ? e.message : 'Image analysis failed.',
    }
  }
}

const TRACKER_JSON_RULES = `You MUST respond with ONLY valid JSON (no markdown, no code fences) using exactly this shape:
{"type":"meal"|"activity"|"suggestion"|"rejected","name":"string","calories":number,"protein":number,"carbs":number,"fats":number,"burned_calories":number,"message":"string","suggestion":"string"}

Rules:
- type "meal": user logged food or a meal photo. Set calories, protein, carbs, fats for that food. burned_calories must be 0. message briefly confirms in English. suggestion optional short idea to reach daily macro targets (or empty string).
- type "activity": user logged exercise or workout photo. Set burned_calories to estimated kcal burned; set meal macros to 0 unless food is also clearly described. message briefly confirms.
- type "suggestion": user asked what to eat next or for a meal idea. Put the proposed meal name in name and estimated macros in calories/protein/carbs/fats. burned_calories 0. message and suggestion are helpful English text.
- type "rejected": not about meals, nutrition, workouts, or daily health goals. Use zeros for numbers; message politely refuses in English.

Always include every key. Use 0 for unused numbers. suggestion may be "".`

/**
 * @param {import('./dailyLogStorage.js').DailyLogItem[]} items
 */
export function buildDailyTrackerSystemPrompt(items) {
  const { targets } = getAiSettings()
  const t = targets
  const {
    consumed_calories,
    consumed_protein,
    consumed_carbs,
    consumed_fats,
    burned_calories,
    net_calories,
  } = computeTotalsFromLogItems(items)
  const today = getTodayDateKey()

  return [
    'You are a personal nutrition and fitness assistant.',
    'Your ONLY job is to help with meals, nutrition, workouts and daily health goals.',
    'Refuse any unrelated questions politely.',
    '',
    `Local calendar date for "today": ${today}.`,
    '',
    'User daily targets (from settings):',
    `- Calories: ${t.calories} kcal`,
    `- Protein: ${t.protein}g`,
    `- Carbs: ${t.carbs}g`,
    `- Fats: ${t.fats}g`,
    '',
    'Already consumed today (from logged meals):',
    `- Calories: ${consumed_calories} kcal`,
    `- Protein: ${consumed_protein}g`,
    `- Carbs: ${consumed_carbs}g`,
    `- Fats: ${consumed_fats}g`,
    '',
    `Burned through activity today: ${burned_calories} kcal`,
    `Net calories today: ${net_calories} kcal`,
    '',
    TRACKER_JSON_RULES,
  ].join('\n')
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** @param {string} text */
export function parseDailyTrackerAiResponse(text) {
  const raw = (text || '').trim()
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const o = JSON.parse(unfenced)
  const type = ['meal', 'activity', 'suggestion', 'rejected'].includes(o.type) ? o.type : 'rejected'
  return {
    type,
    name: typeof o.name === 'string' ? o.name : String(o.name ?? ''),
    calories: num(o.calories),
    protein: num(o.protein),
    carbs: num(o.carbs),
    fats: num(o.fats),
    burned_calories: num(o.burned_calories),
    message: typeof o.message === 'string' ? o.message : String(o.message ?? ''),
    suggestion: typeof o.suggestion === 'string' ? o.suggestion : String(o.suggestion ?? ''),
  }
}

/**
 * @param {{ text?: string, imageBase64?: string | null, currentItems: import('./dailyLogStorage.js').DailyLogItem[] }} params
 * @returns {Promise<{ ok: true, data: ReturnType<typeof parseDailyTrackerAiResponse> } | { ok: false, error: string }>}
 */
export async function analyzeDailyTrackerInput({ text, imageBase64, currentItems }) {
  const { provider, apiKey } = getAiSettings()
  const key = cleanApiKeyForHttp(apiKey)
  if (!key && provider === 'claude') {
    return { ok: false, error: 'Please add your API key in Settings' }
  }

  const system = buildDailyTrackerSystemPrompt(currentItems)
  const userText =
    (text || '').trim() ||
    (imageBase64 ? 'Analyze this image for my daily log (meal or workout). Reply using the JSON rules.' : '')

  if (!userText && !imageBase64) {
    return { ok: false, error: 'Nothing to send.' }
  }

  try {
    let outText
    if (imageBase64) {
      const dataUrl = normalizeBase64ToDataUrl(imageBase64)
      const plainBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      const mediaType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'

      if (provider === 'claude') {
        outText = await anthropicMessages({
          apiKey: key,
          model: ANTHROPIC_MODEL,
          maxTokens: 1200,
          system,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: plainBase64 } },
                { type: 'text', text: userText },
              ],
            },
          ],
        })
      } else {
        const headers = {
          'Content-Type': 'application/json',
        }
        if (key) headers['x-openai-api-key'] = key

        const res = await fetch(`${openAiBaseUrl()}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: OPENAI_MODEL,
            temperature: 0.3,
            max_completion_tokens: 1200,
            reasoning_effort: 'none',
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userText },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg = data?.error?.message || data?.message || res.statusText || 'OpenAI request failed'
          throw new Error(msg)
        }
        outText = data?.choices?.[0]?.message?.content
        if (!outText) throw new Error('Empty response from OpenAI')
      }
    } else if (provider === 'claude') {
      outText = await anthropicMessages({
        apiKey: key,
        model: ANTHROPIC_MODEL,
        maxTokens: 1200,
        system,
        messages: [{ role: 'user', content: userText }],
      })
    } else {
      outText = await openAiChat({
        apiKey: key,
        responseFormatJson: true,
        maxCompletionTokens: 1200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
      })
    }

    let data
    try {
      data = parseDailyTrackerAiResponse(outText)
    } catch {
      return { ok: false, error: 'Could not parse AI response. Try again.' }
    }
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Analysis failed'
    return { ok: false, error: msg }
  }
}
