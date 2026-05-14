import { useState } from 'react'
import { IconMic } from '../components/Icons.jsx'

const seedTasks = [
  { id: 't1', label: 'Walk 20 minutes after lunch', done: false },
  { id: 't2', label: 'Reply to contractor about the deck quote', done: true },
  { id: 't3', label: 'Buy oat milk and eggs', done: false },
]

export default function Todo() {
  const [tasks, setTasks] = useState(seedTasks)
  const [input, setInput] = useState('')

  function toggle(id) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }

  function addTask() {
    const text = input.trim()
    if (!text) return
    setTasks((prev) => [{ id: crypto.randomUUID(), label: text, done: false }, ...prev])
    setInput('')
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Tasks</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">To Do</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
          Speak or type — keep errands and follow-ups in one place.
        </p>
      </header>

      <section className="rounded-[24px] border border-white/10 bg-[#12121a] px-6 py-8 text-center">
        <button
          type="button"
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-[#0a0a0f] shadow-[0_12px_36px_rgba(56,189,248,0.3)] transition hover:scale-[1.02] active:scale-[0.98]"
          aria-label="Voice task (coming soon)"
        >
          <IconMic className="h-9 w-9" />
        </button>
        <p className="mx-auto mt-4 max-w-[260px] text-[14px] text-zinc-500">
          Tap to dictate a task — transcription hooks up in the next step.
        </p>
      </section>

      <div className="flex gap-2 rounded-2xl border border-white/10 bg-[#12121a] p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTask()}
          placeholder="Add a task…"
          className="min-w-0 flex-1 rounded-xl bg-[#1a1a24] px-3 py-2.5 text-[14px] text-white outline-none ring-0 placeholder:text-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={addTask}
          className="shrink-0 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 px-4 py-2 text-[14px] font-semibold text-[#0a0a0f]"
        >
          Add
        </button>
      </div>

      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#12121a] px-3 py-3"
          >
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => toggle(task.id)}
              className="h-5 w-5 rounded border-white/30 bg-[#1a1a24] text-cyan-400 focus:ring-cyan-500/40"
            />
            <span
              className={`flex-1 text-[15px] leading-snug ${
                task.done ? 'text-zinc-500 line-through' : 'text-white'
              }`}
            >
              {task.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
