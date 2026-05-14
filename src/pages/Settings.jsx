import { useEffect, useState } from 'react'
import { AI_STORAGE_KEYS, getAiSettings, saveAiCredentials, testConnection } from '../aiService.js'

export default function Settings() {
  const initial = getAiSettings()
  const [provider, setProvider] = useState(initial.provider)
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [language, setLanguage] = useState(initial.language)
  const [autoConfirm, setAutoConfirm] = useState(initial.autoConfirm)
  const [targets, setTargets] = useState(initial.targets)
  const [saveMessage, setSaveMessage] = useState(null)
  const [connectionTest, setConnectionTest] = useState(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    localStorage.setItem(AI_STORAGE_KEYS.language, language)
  }, [language])

  useEffect(() => {
    localStorage.setItem(AI_STORAGE_KEYS.autoConfirm, autoConfirm ? 'true' : 'false')
  }, [autoConfirm])

  useEffect(() => {
    localStorage.setItem(AI_STORAGE_KEYS.targets, JSON.stringify(targets))
  }, [targets])

  function updateTarget(key, value) {
    const n = Number(value)
    if (Number.isNaN(n)) return
    setTargets((prev) => ({ ...prev, [key]: n }))
  }

  function handleSaveCredentials() {
    saveAiCredentials({ provider, apiKey })
    setSaveMessage('Saved API credentials to this browser.')
    setConnectionTest(null)
  }

  useEffect(() => {
    if (!saveMessage) return undefined
    const id = setTimeout(() => setSaveMessage(null), 4000)
    return () => clearTimeout(id)
  }, [saveMessage])

  async function handleTestConnection() {
    setTesting(true)
    setConnectionTest(null)
    setSaveMessage(null)
    try {
      const result = await testConnection({ provider, apiKey: apiKey.trim() })
      setConnectionTest(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5 pb-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Configure</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Settings</h1>
      </header>

      <section className="space-y-5 rounded-[20px] border border-white/10 bg-[#12121a] p-5">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">AI provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-2 w-full appearance-none rounded-xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] text-white outline-none focus:border-cyan-500/30"
          >
            <option value="openai">OpenAI</option>
            <option value="claude">Claude (Anthropic)</option>
          </select>
          <p className="mt-1.5 text-[12px] text-zinc-600">
            Provider is stored when you click Save. Test connection uses the values currently on this screen.
          </p>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            placeholder="sk-… or sk-ant-…"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] text-white outline-none placeholder:text-zinc-600 focus:border-cyan-500/30"
          />
          <p className="mt-1.5 text-[12px] text-zinc-600">
            The key is saved to localStorage only after you press Save (not on every keystroke).
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleSaveCredentials}
            className="w-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-600 py-3 text-[15px] font-semibold text-[#0a0a0f] transition hover:brightness-105 active:brightness-95 sm:w-auto sm:min-w-[140px] sm:px-8"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            className="w-full rounded-full border border-white/20 py-3 text-[15px] font-semibold text-zinc-100 transition hover:border-white/40 disabled:opacity-50 sm:w-auto sm:min-w-[160px] sm:px-6"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>

        {saveMessage ? (
          <p className="text-[13px] text-emerald-400/95" role="status">
            {saveMessage}
          </p>
        ) : null}

        {connectionTest ? (
          <p
            className={`text-[13px] leading-relaxed ${connectionTest.ok ? 'text-emerald-400/95' : 'text-red-400/95'}`}
            role="status"
          >
            {connectionTest.message}
          </p>
        ) : null}

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-2 w-full appearance-none rounded-xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] text-white outline-none focus:border-cyan-500/30"
          >
            <option value="en">English</option>
            <option value="pl">Polish</option>
          </select>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#1a1a24]/50 px-4 py-3">
          <span className="text-[14px] text-zinc-200">Auto-confirm AI suggestions</span>
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
            className="h-5 w-5 rounded border-white/30 bg-[#1a1a24] text-cyan-400 focus:ring-cyan-500/40"
          />
        </label>

        <p className="text-[12px] leading-relaxed text-zinc-600">Dark mode is always on for the MVP.</p>
      </section>

      <section className="space-y-4 rounded-[20px] border border-white/10 bg-[#12121a] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Daily targets</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'calories', label: 'Calories' },
            { key: 'protein', label: 'Protein (g)' },
            { key: 'carbs', label: 'Carbs (g)' },
            { key: 'fats', label: 'Fats (g)' },
          ].map((field) => (
            <div key={field.key}>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{field.label}</label>
              <input
                type="number"
                min={0}
                value={targets[field.key]}
                onChange={(e) => updateTarget(field.key, e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#1a1a24] px-3 py-2.5 text-[14px] text-white tabular-nums outline-none focus:border-cyan-500/30"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden rounded-[20px] border border-white/10 bg-[#12121a] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Future integrations</p>
        <p className="mt-3 text-[13px] leading-relaxed text-zinc-600">
          Supabase · Gmail · Outlook · Google Calendar · Todoist · Notion · n8n · Fitness APIs
        </p>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0a0a0f]/55 backdrop-blur-[1px]">
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[12px] font-medium text-zinc-300">
            Request access
          </span>
        </div>
      </section>
    </div>
  )
}
