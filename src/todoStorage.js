import { DAY_KEYS, getTodayDayKey } from './todoDays.js'

/** @typedef {import('./todoDays.js').DayKey} DayKey */

/**
 * @typedef {object} TodoTask
 * @property {string} id
 * @property {string} title
 * @property {string} note
 * @property {DayKey} day
 * @property {boolean} completed
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export const TODO_STORAGE_KEY = 'dailyAiHub_todoWeekly'

export const nowIso = () => new Date().toISOString()

/** @returns {Record<DayKey, TodoTask[]>} */
export function makeEmptyWeek() {
  return DAY_KEYS.reduce((acc, day) => {
    acc[day] = []
    return acc
  }, /** @type {Record<DayKey, TodoTask[]>} */ ({}))
}

function seedMondayTasks() {
  const createdAt = nowIso()
  return [
    {
      id: crypto.randomUUID(),
      title: 'Walk 20 minutes after lunch',
      note: 'Easy pace is enough.',
      day: /** @type {DayKey} */ ('monday'),
      completed: false,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: crypto.randomUUID(),
      title: 'Reply to contractor about deck quote',
      note: 'Confirm timeline and materials.',
      day: /** @type {DayKey} */ ('monday'),
      completed: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: crypto.randomUUID(),
      title: 'Buy oat milk and eggs',
      note: '',
      day: /** @type {DayKey} */ ('monday'),
      completed: false,
      createdAt,
      updatedAt: createdAt,
    },
  ]
}

/**
 * @param {unknown} task
 * @param {DayKey} day
 * @returns {TodoTask | null}
 */
function normalizeTask(task, day) {
  const title = String(task?.title || '').trim()
  if (!title) return null
  return {
    id: String(task?.id || crypto.randomUUID()),
    title,
    note: String(task?.note || ''),
    day,
    completed: Boolean(task?.completed),
    createdAt: String(task?.createdAt || nowIso()),
    updatedAt: String(task?.updatedAt || nowIso()),
  }
}

/**
 * Load weekly tasks from localStorage (seeds Monday demos when empty).
 * @returns {Record<DayKey, TodoTask[]>}
 */
export function loadTasksByDay() {
  const fallback = makeEmptyWeek()
  fallback.monday = seedMondayTasks()

  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(TODO_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const week = makeEmptyWeek()
    for (const day of DAY_KEYS) {
      const arr = Array.isArray(parsed?.[day]) ? parsed[day] : []
      week[day] = arr.map((task) => normalizeTask(task, day)).filter(Boolean)
    }
    return week
  } catch {
    return fallback
  }
}

/**
 * @param {Record<DayKey, TodoTask[]>} tasksByDay
 */
export function saveTasksByDay(tasksByDay) {
  if (typeof window === 'undefined') return
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(tasksByDay))
}

/** @param {string} title */
export function normalizeTodoTitleKey(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * @param {Record<DayKey, TodoTask[]>} week
 * @param {string} title
 * @param {DayKey} day
 */
export function isDuplicateTodo(week, title, day) {
  const key = normalizeTodoTitleKey(title)
  if (!key) return true
  const list = week[day] || []
  return list.some((t) => normalizeTodoTitleKey(t.title) === key)
}

/**
 * @param {{ title: string, note?: string, day?: DayKey | null, completed?: boolean }} args
 * @returns {TodoTask}
 */
export function createTodoTask({ title, note = '', day = null, completed = false }) {
  const at = nowIso()
  const targetDay = day || getTodayDayKey()
  return {
    id: crypto.randomUUID(),
    title: String(title || '').trim(),
    note: String(note || ''),
    day: targetDay,
    completed: Boolean(completed),
    createdAt: at,
    updatedAt: at,
  }
}

/**
 * @typedef {object} ApprovedTodoCandidate
 * @property {string} title
 * @property {string} [note]
 * @property {DayKey} day
 * @property {boolean} [selected]
 */

/**
 * Persist user-approved tasks into weekly To Do storage. Skips duplicates (same day + title).
 * @param {ApprovedTodoCandidate[]} candidates
 * @returns {{ added: TodoTask[], skipped: ApprovedTodoCandidate[], week: Record<DayKey, TodoTask[]> }}
 */
export function addApprovedTasks(candidates) {
  const week = loadTasksByDay()
  /** @type {TodoTask[]} */
  const added = []
  /** @type {ApprovedTodoCandidate[]} */
  const skipped = []

  for (const candidate of candidates) {
    if (candidate.selected === false) continue
    const title = String(candidate.title || '').trim()
    if (!title) continue
    const day = candidate.day || getTodayDayKey()
    if (isDuplicateTodo(week, title, day)) {
      skipped.push({ ...candidate, title, day })
      continue
    }
    const task = createTodoTask({
      title,
      note: candidate.note || '',
      day,
    })
    week[day] = [task, ...(week[day] || [])]
    added.push(task)
  }

  if (added.length) saveTasksByDay(week)
  return { added, skipped, week }
}
