import { useEffect, useState } from 'react'

const STORAGE_KEY = 'dailyAiHub_todoWeekly'
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}
const DAY_SHORT = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

const nowIso = () => new Date().toISOString()

function makeEmptyWeek() {
  return DAY_KEYS.reduce((acc, day) => {
    acc[day] = []
    return acc
  }, {})
}

function seedMondayTasks() {
  const createdAt = nowIso()
  return [
    {
      id: crypto.randomUUID(),
      title: 'Walk 20 minutes after lunch',
      note: 'Easy pace is enough.',
      day: 'monday',
      completed: false,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: crypto.randomUUID(),
      title: 'Reply to contractor about deck quote',
      note: 'Confirm timeline and materials.',
      day: 'monday',
      completed: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: crypto.randomUUID(),
      title: 'Buy oat milk and eggs',
      note: '',
      day: 'monday',
      completed: false,
      createdAt,
      updatedAt: createdAt,
    },
  ]
}

function readInitialTasksByDay() {
  const fallback = makeEmptyWeek()
  fallback.monday = seedMondayTasks()

  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const week = makeEmptyWeek()
    for (const day of DAY_KEYS) {
      const arr = Array.isArray(parsed?.[day]) ? parsed[day] : []
      week[day] = arr
        .map((task) => ({
          id: String(task?.id || crypto.randomUUID()),
          title: String(task?.title || '').trim(),
          note: String(task?.note || ''),
          day,
          completed: Boolean(task?.completed),
          createdAt: String(task?.createdAt || nowIso()),
          updatedAt: String(task?.updatedAt || nowIso()),
        }))
        .filter((task) => task.title)
    }
    return week
  } catch {
    return fallback
  }
}

function IconEye({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  )
}

function IconEyeOff({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 3 21 21" />
      <path d="M9.8 5.4A11.6 11.6 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.1 4.2" />
      <path d="M6.4 8.3A18 18 0 0 0 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.8" />
      <path d="M10.7 10.7a2 2 0 0 0 2.6 2.6" />
    </svg>
  )
}

function IconInfo({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7.25h.01" strokeLinecap="round" />
    </svg>
  )
}

export default function Todo() {
  const [tasksByDay, setTasksByDay] = useState(readInitialTasksByDay)
  const [selectedDay, setSelectedDay] = useState('monday')
  const [hideCompleted, setHideCompleted] = useState(false)
  const [input, setInput] = useState('')
  const [editingTaskId, setEditingTaskId] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [menuTaskId, setMenuTaskId] = useState('')
  const [menuNote, setMenuNote] = useState('')
  const [isEditingNote, setIsEditingNote] = useState(false)

  const dayTasks = tasksByDay[selectedDay] || []
  const completedCount = dayTasks.filter((t) => t.completed).length
  const visibleTasks = hideCompleted ? dayTasks.filter((t) => !t.completed) : dayTasks

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasksByDay))
  }, [tasksByDay])

  function updateDay(day, updater) {
    setTasksByDay((prev) => {
      const next = { ...prev, [day]: updater(prev[day] || []) }
      return next
    })
  }

  function addTask() {
    const title = input.trim()
    if (!title) return
    const at = nowIso()
    const task = {
      id: crypto.randomUUID(),
      title,
      note: '',
      day: selectedDay,
      completed: false,
      createdAt: at,
      updatedAt: at,
    }
    updateDay(selectedDay, (prev) => [task, ...prev])
    setInput('')
  }

  function toggleTask(taskId) {
    updateDay(selectedDay, (prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, completed: !task.completed, updatedAt: nowIso() } : task)),
    )
  }

  function clearCompletedForSelectedDay() {
    updateDay(selectedDay, (prev) => prev.filter((task) => !task.completed))
    if (menuTaskId && (tasksByDay[selectedDay] || []).find((t) => t.id === menuTaskId)?.completed) {
      setMenuTaskId('')
      setIsEditingNote(false)
    }
  }

  function startInlineEdit(task) {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
    setMenuTaskId('')
  }

  function saveInlineEdit() {
    const title = editingTitle.trim()
    if (!editingTaskId) return
    if (!title) {
      setEditingTaskId('')
      setEditingTitle('')
      return
    }
    updateDay(selectedDay, (prev) =>
      prev.map((task) => (task.id === editingTaskId ? { ...task, title, updatedAt: nowIso() } : task)),
    )
    setEditingTaskId('')
    setEditingTitle('')
  }

  function openTaskMenu(task) {
    const nextId = menuTaskId === task.id ? '' : task.id
    setMenuTaskId(nextId)
    setIsEditingNote(false)
    setMenuNote(task.note || '')
  }

  const activeTask = dayTasks.find((task) => task.id === menuTaskId) || null

  function saveTaskNote() {
    if (!activeTask) return
    updateDay(selectedDay, (prev) =>
      prev.map((task) => (task.id === activeTask.id ? { ...task, note: menuNote.trim(), updatedAt: nowIso() } : task)),
    )
    setIsEditingNote(false)
  }

  function moveTask(targetDay) {
    if (!activeTask || targetDay === selectedDay) return
    const moved = { ...activeTask, day: targetDay, updatedAt: nowIso() }
    updateDay(selectedDay, (prev) => prev.filter((task) => task.id !== activeTask.id))
    updateDay(targetDay, (prev) => [moved, ...prev])
    setMenuTaskId('')
    setIsEditingNote(false)
  }

  function deleteTask() {
    if (!activeTask) return
    updateDay(selectedDay, (prev) => prev.filter((task) => task.id !== activeTask.id))
    setMenuTaskId('')
    setIsEditingNote(false)
  }

  function openTasksCount(day) {
    return (tasksByDay[day] || []).filter((task) => !task.completed).length
  }

  return (
    <div className="space-y-4 pb-[calc(13rem+max(1rem,env(safe-area-inset-bottom)))]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">To Do</h1>
          <p className="mt-1 text-[15px] text-zinc-400">{DAY_LABELS[selectedDay]}</p>
        </div>
        <button
          type="button"
          onClick={() => setHideCompleted((v) => !v)}
          className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
            hideCompleted
              ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-300'
              : 'border-white/15 bg-white/5 text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
        >
          {hideCompleted ? <IconEyeOff /> : <IconEye />}
        </button>
      </header>

      <section className="rounded-2xl border border-white/10 bg-[#12121a]/95 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-medium text-zinc-300">{completedCount} Completed</p>
          <button
            type="button"
            onClick={clearCompletedForSelectedDay}
            disabled={completedCount === 0}
            className="rounded-full px-3 py-1 text-[13px] font-medium text-cyan-300 disabled:text-zinc-600"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#12121a]/95">
        {visibleTasks.length === 0 ? (
          <p className="px-4 py-6 text-[14px] text-zinc-500">No tasks for {DAY_LABELS[selectedDay].toLowerCase()}.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {visibleTasks.map((task) => (
              <li key={task.id} className={`px-4 py-3 ${task.completed ? 'opacity-55' : ''}`}>
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                      task.completed
                        ? 'border-cyan-400 bg-cyan-400 text-[#0a0a0f]'
                        : 'border-white/35 bg-transparent text-transparent hover:border-cyan-400'
                    }`}
                    aria-label={task.completed ? 'Mark task incomplete' : 'Mark task complete'}
                  >
                    <span className="text-[14px] font-bold">✓</span>
                  </button>

                  <div className="min-w-0 flex-1">
                    {editingTaskId === task.id ? (
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={saveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveInlineEdit()
                          if (e.key === 'Escape') {
                            setEditingTaskId('')
                            setEditingTitle('')
                          }
                        }}
                        autoFocus
                        className="w-full rounded-lg bg-[#1a1a24] px-2.5 py-1.5 text-[15px] text-white outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startInlineEdit(task)}
                        className={`w-full text-left text-[15px] leading-snug ${
                          task.completed ? 'text-zinc-400 line-through' : 'text-white'
                        }`}
                      >
                        {task.title}
                      </button>
                    )}
                    {task.note ? <p className="mt-1 text-[12px] leading-snug text-zinc-500">{task.note}</p> : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => openTaskMenu(task)}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-zinc-400 transition ${
                      menuTaskId === task.id
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                        : 'border-white/15 bg-white/5 hover:text-zinc-200'
                    }`}
                    aria-label="Task options"
                  >
                    <IconInfo />
                  </button>
                </div>

                {menuTaskId === task.id ? (
                  <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-[#0f0f17] p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startInlineEdit(task)}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-zinc-300"
                      >
                        Edit task
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuNote(task.note || '')
                          setIsEditingNote((v) => !v)
                        }}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-zinc-300"
                      >
                        {task.note ? 'Edit note' : 'Add note'}
                      </button>
                      <button
                        type="button"
                        onClick={deleteTask}
                        className="rounded-full border border-rose-500/40 px-3 py-1.5 text-[12px] text-rose-200"
                      >
                        Delete task
                      </button>
                    </div>

                    {isEditingNote ? (
                      <div className="flex gap-2">
                        <input
                          value={menuNote}
                          onChange={(e) => setMenuNote(e.target.value)}
                          placeholder="Add a short note…"
                          className="min-w-0 flex-1 rounded-lg bg-[#1a1a24] px-3 py-2 text-[13px] text-white outline-none placeholder:text-zinc-600"
                        />
                        <button
                          type="button"
                          onClick={saveTaskNote}
                          className="rounded-lg bg-gradient-to-r from-cyan-400 to-blue-600 px-3 py-2 text-[12px] font-semibold text-[#0a0a0f]"
                        >
                          Save
                        </button>
                      </div>
                    ) : null}

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Move to</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {DAY_KEYS.map((day) => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => moveTask(day)}
                            disabled={day === selectedDay}
                            className={`rounded-full border px-3 py-1 text-[12px] ${
                              day === selectedDay
                                ? 'border-white/10 text-zinc-600'
                                : 'border-white/15 text-zinc-300 hover:border-cyan-500/35 hover:text-cyan-200'
                            }`}
                          >
                            {DAY_LABELS[day]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+max(0.75rem,env(safe-area-inset-bottom)))] z-[45] flex justify-center px-4 pb-2">
        <div className="pointer-events-auto w-full max-w-[398px] space-y-3 rounded-2xl border border-white/10 bg-[#12121a]/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="Add a task…"
              className="min-w-0 flex-1 rounded-xl bg-[#1a1a24] px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-zinc-600"
            />
            <button
              type="button"
              onClick={addTask}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 text-[20px] font-semibold leading-none text-[#0a0a0f]"
              aria-label="Add task"
            >
              +
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {DAY_KEYS.map((day) => {
              const selected = day === selectedDay
              const openCount = openTasksCount(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={`relative rounded-xl border px-1 py-2 text-center text-[12px] font-medium transition ${
                    selected
                      ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200'
                      : 'border-white/10 bg-[#15151f] text-zinc-400'
                  }`}
                >
                  {DAY_SHORT[day]}
                  {openCount > 0 ? (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
