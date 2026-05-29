/** @typedef {'monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday'} DayKey */

export const DAY_KEYS = /** @type {const} */ ([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
])

const JS_DAY_TO_KEY = /** @type {const} */ ([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
])

/** Local calendar weekday key for today. */
export function getTodayDayKey(ref = new Date()) {
  return JS_DAY_TO_KEY[ref.getDay()]
}

/** @param {DayKey} dayKey @param {number} offsetDays */
function dayKeyPlusOffset(dayKey, offsetDays, ref = new Date()) {
  const idx = DAY_KEYS.indexOf(dayKey)
  if (idx < 0) return getTodayDayKey(ref)
  const d = new Date(ref)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return JS_DAY_TO_KEY[d.getDay()]
}

const WEEKDAY_PATTERNS = [
  { key: 'monday', re: /\b(monday|mon|poniedziałek|poniedzialek|lunes)\b/i },
  { key: 'tuesday', re: /\b(tuesday|tue|wtorek|martes)\b/i },
  { key: 'wednesday', re: /\b(wednesday|wed|środa|sroda|miércoles|miercoles)\b/i },
  { key: 'thursday', re: /\b(thursday|thu|czwartek|jueves)\b/i },
  { key: 'friday', re: /\b(friday|fri|piątek|piatek|viernes)\b/i },
  { key: 'saturday', re: /\b(saturday|sat|sobota|sábado|sabado)\b/i },
  { key: 'sunday', re: /\b(sunday|sun|niedziela|domingo)\b/i },
]

/**
 * Parse target day from mixed PL/EN/ES task text.
 * @param {string} text
 * @param {Date} [ref]
 * @returns {DayKey | null} null = no explicit date (use today / selected day)
 */
export function parseTodoDayFromText(text, ref = new Date()) {
  const sample = String(text || '').toLowerCase()

  if (/\b(today|dziś|dzis|hoy)\b/i.test(sample)) return getTodayDayKey(ref)

  if (/\b(tomorrow|jutro|mañana|manana)\b/i.test(sample)) {
    return dayKeyPlusOffset(getTodayDayKey(ref), 1, ref)
  }

  for (const { key, re } of WEEKDAY_PATTERNS) {
    if (!re.test(sample)) continue
    const targetIdx = DAY_KEYS.indexOf(key)
    const todayIdx = DAY_KEYS.indexOf(getTodayDayKey(ref))
    let daysUntil = (targetIdx - todayIdx + 7) % 7
    if (daysUntil === 0) daysUntil = 0
    return dayKeyPlusOffset(getTodayDayKey(ref), daysUntil, ref)
  }

  return null
}
