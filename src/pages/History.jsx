import { useEffect, useMemo, useState } from 'react'
import { listDailyLogDateKeys, loadDailyLog } from '../dailyLogStorage.js'

function formatSectionTitle(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

const kindStyles = {
  Meal: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  Workout: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
}

export default function History() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onFocus = () => setTick((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const sections = useMemo(() => {
    void tick
    const keys = listDailyLogDateKeys()
    return keys
      .map((dateKey) => {
        const items = loadDailyLog(dateKey)
        if (!items.length) return null
        const entries = []
        for (const it of [...items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )) {
          const kind = it.sourceType === 'meal' ? 'Meal' : 'Workout'
          const detail =
            it.sourceType === 'meal'
              ? `${it.calories} kcal · ${it.protein}P · ${it.carbs}C · ${it.fats}F`
              : `~${it.burned_calories} kcal burned`
          const text = [it.name, detail, it.message].filter(Boolean).join(' — ')
          entries.push({
            id: it.id,
            time: new Date(it.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
            kind,
            text,
          })
        }
        return { dateKey, title: formatSectionTitle(dateKey), entries }
      })
      .filter(Boolean)
  }, [tick])

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Journal</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">History</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
          Past days are loaded from saved daily logs on this device.
        </p>
      </header>

      {sections.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-[#12121a] px-4 py-6 text-center text-[14px] text-zinc-500">
          No saved logs yet. Entries you log on the Daily Tracker appear here by date.
        </p>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.dateKey}>
              <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-zinc-500">
                {section.title}
              </h2>
              <ul className="space-y-3">
                {section.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-2xl border border-white/10 bg-[#12121a] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
                      <span className="tabular-nums text-zinc-400">{entry.time}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${kindStyles[entry.kind]}`}
                      >
                        {entry.kind}
                      </span>
                    </div>
                    <p className="mt-2 text-[15px] leading-relaxed text-zinc-100">{entry.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
