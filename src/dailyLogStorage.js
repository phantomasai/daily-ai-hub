/** @typedef {{ id: string, sourceType: 'meal' | 'activity', name: string, calories: number, protein: number, carbs: number, fats: number, burned_calories: number, message: string, suggestion: string, createdAt: string }} DailyLogItem */

export function getTodayDateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dailyLogStorageKey(dateKey) {
  return `dailyLog_${dateKey}`
}

/** @param {string} dateKey */
export function loadDailyLog(dateKey) {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(dailyLogStorageKey(dateKey))
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** @param {string} dateKey @param {DailyLogItem[]} items */
export function saveDailyLog(dateKey, items) {
  if (typeof window === 'undefined') return
  localStorage.setItem(dailyLogStorageKey(dateKey), JSON.stringify(items))
}

/** @param {DailyLogItem[]} items */
export function computeTotalsFromLogItems(items) {
  let consumed_calories = 0
  let consumed_protein = 0
  let consumed_carbs = 0
  let consumed_fats = 0
  let burned_calories = 0

  for (const it of items) {
    if (it.sourceType === 'meal') {
      consumed_calories += Number(it.calories) || 0
      consumed_protein += Number(it.protein) || 0
      consumed_carbs += Number(it.carbs) || 0
      consumed_fats += Number(it.fats) || 0
    } else if (it.sourceType === 'activity') {
      burned_calories += Number(it.burned_calories) || 0
    }
  }

  return {
    consumed_calories,
    consumed_protein,
    consumed_carbs,
    consumed_fats,
    burned_calories,
    net_calories: consumed_calories - burned_calories,
  }
}

export function listDailyLogDateKeys() {
  if (typeof window === 'undefined') return []
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('dailyLog_')) keys.push(k.slice('dailyLog_'.length))
  }
  return keys.sort((a, b) => b.localeCompare(a))
}
