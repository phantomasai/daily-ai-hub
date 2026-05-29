import { cleanApiKeyForHttp, getAiSettings } from './aiService.js'
import { MIXED_LANGUAGE_AI_RULE } from './aiPrompts.js'
import { DAY_KEYS, getTodayDayKey, parseTodoDayFromText } from './todoDays.js'

/** @typedef {import('./todoDays.js').DayKey} DayKey */
/** @typedef {'low'|'medium'|'high'} TodoPriority */

/**
 * @typedef {object} ExtractedTodoTask
 * @property {string} title
 * @property {DayKey | null} day
 * @property {string | null} time
 * @property {TodoPriority | null} priority
 */

const COMMAND_PREFIX =
  /^(zapisz( mi)?|dodaj( mi)?( zadanie| task)?|przypomnij( mi)?|add( a)?( task)?|create( a)?( task)?|remind me( to)?|remind( me)?( to)?|record|save|note( to)?|añade|añadir|agregar|recuerdame|recuérdame)\s+/iu

const SCHEDULING_PHRASES = [
  /\s+na\s+(poniedziałek|poniedzialek|wtorek|środę|srode|czwartek|piątek|piatek|sobotę|sobote|niedzielę|niedziele)\b/giu,
  /\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/giu,
  /\s+el\s+(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/giu,
  /\s+(today|tomorrow|jutro|mañana|manana|dziś|dzis|hoy)\b/giu,
  /\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/giu,
  /\s+(poniedziałek|poniedzialek|wtorek|środa|sroda|czwartek|piątek|piatek|sobota|niedziela)\b/giu,
  /\s+(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/giu,
  /\s+(morning|afternoon|evening|night|rano|wieczorem|por la mañana|por la tarde)\b/giu,
]

const TIME_PATTERN =
  /\b(\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m|morning|afternoon|evening|night|rano|wieczorem|por la mañana|por la tarde)\b/giu

const PRIORITY_PATTERN = /\b(urgent|asap|high priority|wysoki priorytet|pilne|alta prioridad)\b/giu

/**
 * @param {unknown} value
 * @returns {DayKey | null}
 */
function parseDayKey(value) {
  const d = String(value || '').toLowerCase().trim()
  return DAY_KEYS.includes(/** @type {DayKey} */ (d)) ? /** @type {DayKey} */ (d) : null
}

/**
 * @param {unknown} value
 * @returns {TodoPriority | null}
 */
function parsePriority(value) {
  const p = String(value || '').toLowerCase().trim()
  if (p === 'low' || p === 'medium' || p === 'high') return p
  return null
}

/**
 * @param {string} raw
 * @param {Date} ref
 * @returns {ExtractedTodoTask}
 */
export function extractTodoTaskHeuristic(raw, ref = new Date()) {
  const input = raw.trim()
  if (!input) return { title: '', day: null, time: null, priority: null }

  const day = parseTodoDayFromText(input, ref)
  let time = null
  const timeMatch = input.match(TIME_PATTERN)
  if (timeMatch) time = timeMatch[0].trim()

  let priority = null
  if (PRIORITY_PATTERN.test(input)) priority = 'high'

  let title = input.replace(COMMAND_PREFIX, '').trim()
  for (const re of SCHEDULING_PHRASES) {
    title = title.replace(re, '')
  }
  if (time) title = title.replace(TIME_PATTERN, '')
  title = title.replace(/\s{2,}/g, ' ').replace(/^[,.\-–—]+\s*|\s*[,.\-–—]+$/g, '').trim()

  return {
    title: title || input,
    day,
    time,
    priority,
  }
}

/**
 * @param {string} raw
 * @param {Date} ref
 * @param {string} apiKey
 * @returns {Promise<ExtractedTodoTask | null>}
 */
async function extractTodoTaskAI(raw, ref, apiKey) {
  const todayKey = getTodayDayKey(ref)
  const todayLabel = ref.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })

  try {
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
              'You extract to-do tasks from natural-language commands.',
              MIXED_LANGUAGE_AI_RULE,
              'Return ONLY valid JSON:',
              '{"title":"string","day":"monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday"|null,"time":"string"|null,"priority":"low"|"medium"|"high"|null}',
              'CRITICAL: Never translate the task title. Polish stays Polish, Spanish stays Spanish, English stays English.',
              'Remove command phrases only: zapisz, dodaj, przypomnij mi, remind me, add task, create task, añade, etc.',
              'Put scheduling in day/time fields, not in title.',
              `Today is ${todayKey} (${todayLabel}). Map jutro/tomorrow/mañana to the correct day key.`,
              'title: short clean task in the user\'s original language.',
              'time: optional time phrase in original language (e.g. "rano", "10:30", "morning") or null.',
              'Examples:',
              '"zapisz zmianę opony na wtorek" -> title "zmiana opony", day "tuesday"',
              '"dodaj task kupić baterie jutro" -> title "kupić baterie", day tomorrow relative',
              '"remind me to call supplier tomorrow" -> title "call supplier", day tomorrow relative',
              '"comprar arroz mañana" -> title "comprar arroz", day tomorrow relative',
              '"kup whey protein jutro" -> title "kup whey protein", day tomorrow relative',
            ].join(' '),
          },
          { role: 'user', content: raw },
        ],
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return null
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content)
    const title = String(parsed.title || '').trim()
    if (!title) return null

    const aiDay = parseDayKey(parsed.day)
    const heuristicDay = parseTodoDayFromText(raw, ref)

    return {
      title,
      day: aiDay || heuristicDay,
      time: parsed.time ? String(parsed.time).trim() : null,
      priority: parsePriority(parsed.priority),
    }
  } catch {
    return null
  }
}

/**
 * Extract task title and metadata from mixed-language input.
 * @param {string} input
 * @param {Date} [ref]
 * @returns {Promise<ExtractedTodoTask>}
 */
export async function extractTodoTask(input, ref = new Date()) {
  const raw = input.trim()
  if (!raw) return { title: '', day: null, time: null, priority: null }

  const key = cleanApiKeyForHttp(getAiSettings().apiKey)
  if (key) {
    const ai = await extractTodoTaskAI(raw, ref, key)
    if (ai?.title) return ai
  }

  return extractTodoTaskHeuristic(raw, ref)
}
