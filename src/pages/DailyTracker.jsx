import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { analyzeDailyTrackerInput, cleanApiKeyForHttp, getAiSettings } from '../aiService.js'
import { createVoiceRecorder, getVoiceStatusLabel, isAudioRecordingSupported } from '../trackerAudio.js'
import {
  computeTotalsFromLogItems,
  getTodayDateKey,
  loadDailyLog,
  saveDailyLog,
} from '../dailyLogStorage.js'
import { IconCamera, IconMic, IconPulse, IconSend, IconTrash, IconUtensils } from '../components/Icons.jsx'

function MacroBar({ label, current, target, colorClass }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-300">
          <span className="text-white">{current}</span>
          <span className="text-zinc-500"> / {target}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function DailyTracker() {
  const fileRef = useRef(null)
  const voiceRecorderRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const [dateKey, setDateKey] = useState(getTodayDateKey)
  const [items, setItems] = useState(() => loadDailyLog(getTodayDateKey()))
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [voicePhase, setVoicePhase] = useState('idle')
  const [transcriptPreview, setTranscriptPreview] = useState('')
  const [aiMessage, setAiMessage] = useState('')
  const [macroInsight, setMacroInsight] = useState('')
  const [pendingSuggestion, setPendingSuggestion] = useState(null)
  const [settingsTick, setSettingsTick] = useState(0)

  const targets = useMemo(() => getAiSettings().targets, [settingsTick, dateKey])
  const hasApiKey = useMemo(() => cleanApiKeyForHttp(getAiSettings().apiKey).length > 0, [settingsTick, dateKey])

  const totals = useMemo(() => computeTotalsFromLogItems(items), [items])

  useEffect(() => {
    setItems(loadDailyLog(dateKey))
    setPendingSuggestion(null)
    setAiMessage('')
  }, [dateKey])

  useEffect(() => {
    const id = setInterval(() => {
      const next = getTodayDateKey()
      setDateKey((prev) => (prev !== next ? next : prev))
    }, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onFocus = () => setSettingsTick((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const runAnalysis = async (text, imageBase64) => {
    if (!hasApiKey) {
      setAiMessage('Please add your API key in Settings')
      return
    }
    setLoading(true)
    setAiMessage('')
    try {
      const snapshot = items
      const result = await analyzeDailyTrackerInput({
        text: text ?? draft,
        imageBase64: imageBase64 ?? null,
        currentItems: snapshot,
      })
      if (!result.ok) {
        setAiMessage(result.error)
        return
      }
      const d = result.data

      if (d.type === 'rejected') {
        setAiMessage(d.message)
        setPendingSuggestion(null)
        return
      }

      if (d.type === 'suggestion') {
        setPendingSuggestion(d)
        setAiMessage(d.message)
        if (d.suggestion) setMacroInsight(d.suggestion)
        return
      }

      const newItem =
        d.type === 'meal'
          ? {
              id: crypto.randomUUID(),
              sourceType: 'meal',
              name: d.name,
              calories: d.calories,
              protein: d.protein,
              carbs: d.carbs,
              fats: d.fats,
              burned_calories: 0,
              message: d.message,
              suggestion: d.suggestion || '',
              createdAt: new Date().toISOString(),
            }
          : {
              id: crypto.randomUUID(),
              sourceType: 'activity',
              name: d.name,
              calories: 0,
              protein: 0,
              carbs: 0,
              fats: 0,
              burned_calories: d.burned_calories,
              message: d.message,
              suggestion: d.suggestion || '',
              createdAt: new Date().toISOString(),
            }

      setItems((prev) => {
        const next = [newItem, ...prev]
        saveDailyLog(dateKey, next)
        return next
      })
      setAiMessage(d.message)
      if (d.suggestion) setMacroInsight(d.suggestion)
      setPendingSuggestion(null)
      setDraft('')
    } finally {
      setLoading(false)
    }
  }

  async function handleSend() {
    const t = draft.trim()
    if (!t || loading) return
    await runAnalysis(t, null)
  }

  function handlePickPhoto() {
    fileRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || loading) return
    setLoading(true)
    setAiMessage('')
    const reader = new FileReader()
    reader.onerror = () => {
      setLoading(false)
      setAiMessage('Could not read image.')
    }
    reader.onload = async () => {
      try {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        const hint = draft.trim() || 'Analyze this image for my daily log (meal or workout).'
        setDraft('')
        await runAnalysis(hint, base64)
      } finally {
        setLoading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  function getVoiceRecorder() {
    if (!voiceRecorderRef.current) {
      voiceRecorderRef.current = createVoiceRecorder({ onPhase: setVoicePhase })
    }
    return voiceRecorderRef.current
  }

  useEffect(() => {
    return () => voiceRecorderRef.current?.cancel()
  }, [])

  async function toggleVoice() {
    if (voicePhase === 'transcribing' || loading) return

    const rec = getVoiceRecorder()

    if (voicePhase === 'recording') {
      setAiMessage('')
      try {
        const said = await rec.stopAndTranscribe()
        setTranscriptPreview(said)
        setDraft(said)
        window.setTimeout(() => setTranscriptPreview(''), 5000)
        console.log('[voice] analysis started')
        await runAnalysis(said, null)
      } catch (err) {
        setAiMessage(err instanceof Error ? err.message : 'Could not capture voice.')
      }
      return
    }

    if (voicePhase !== 'idle') return

    setAiMessage('')
    setTranscriptPreview('')
    if (!isAudioRecordingSupported()) {
      setAiMessage('Audio recording is not supported in this browser.')
      return
    }
    try {
      await rec.start()
    } catch (err) {
      setAiMessage(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  const voiceBusy = voicePhase !== 'idle' || loading
  const statusLabel = getVoiceStatusLabel(voicePhase, loading)

  useEffect(() => {
    const text = typeof location.state?.analyzeText === 'string' ? location.state.analyzeText.trim() : ''
    if (!text) return
    navigate('.', { replace: true, state: {} })
    setDraft(text)
    console.log('[voice] analysis started')
    void runAnalysis(text, null)
  }, [location.state?.analyzeText])

  function removeItem(id) {
    setItems((prev) => {
      const next = prev.filter((x) => x.id !== id)
      saveDailyLog(dateKey, next)
      return next
    })
  }

  function handleSave() {
    saveDailyLog(dateKey, items)
    setAiMessage('Saved today’s log.')
    setTimeout(() => setAiMessage((m) => (m === 'Saved today’s log.' ? '' : m)), 2500)
  }

  function handleClean() {
    if (!items.length && !pendingSuggestion) return
    if (!window.confirm('Clear today’s log on this device?')) return
    setItems([])
    saveDailyLog(dateKey, [])
    setPendingSuggestion(null)
    setMacroInsight('')
    setAiMessage('Cleared today’s log.')
  }

  function logSuggestedMeal() {
    if (!pendingSuggestion) return
    const d = pendingSuggestion
    const newItem = {
      id: crypto.randomUUID(),
      sourceType: 'meal',
      name: d.name,
      calories: d.calories,
      protein: d.protein,
      carbs: d.carbs,
      fats: d.fats,
      burned_calories: 0,
      message: d.message || 'Logged suggested meal.',
      suggestion: d.suggestion || '',
      createdAt: new Date().toISOString(),
    }
    setItems((prev) => {
      const next = [newItem, ...prev]
      saveDailyLog(dateKey, next)
      return next
    })
    setPendingSuggestion(null)
    setAiMessage('Suggested meal added to your log.')
  }

  const insightText =
    macroInsight ||
    (totals.consumed_calories > 0
      ? 'Keep logging — I’ll refine tips as your day fills in.'
      : 'Log a meal or workout to get tailored macro tips.')

  return (
    <div className="pb-[calc(17rem+max(1rem,env(safe-area-inset-bottom)))]">
      {!hasApiKey ? (
        <p className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-100/95">
          Please add your API key in{' '}
          <Link to="/settings" className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
            Settings
          </Link>
          .
        </p>
      ) : null}

      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Today</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Daily Tracker</h1>
          <p className="mt-1 text-[12px] text-zinc-600">{dateKey}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:border-white/40"
          >
            <span aria-hidden>💾</span>
            Save
          </button>
          <button
            type="button"
            onClick={handleClean}
            className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:border-white/40"
          >
            <span aria-hidden>✨</span>
            Clean
          </button>
        </div>
      </header>

      <section className="mb-4 space-y-5 rounded-[24px] border border-white/10 bg-[#12121a] p-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-zinc-400">Calories (food)</span>
          <p className="text-sm tabular-nums text-zinc-300">
            <span className="text-lg font-semibold text-cyan-400">{totals.consumed_calories}</span>
            <span className="text-zinc-500"> / {targets.calories} kcal</span>
          </p>
        </div>
        <p className="text-[12px] text-zinc-500">
          Burned today:{' '}
          <span className="font-medium text-zinc-300">{totals.burned_calories} kcal</span>
          {' · '}
          Net: <span className="font-medium text-zinc-300">{totals.net_calories} kcal</span>
        </p>

        <div className="space-y-4">
          <MacroBar
            label="Protein"
            current={totals.consumed_protein}
            target={targets.protein}
            colorClass="bg-emerald-400"
          />
          <MacroBar
            label="Carbs"
            current={totals.consumed_carbs}
            target={targets.carbs}
            colorClass="bg-amber-400"
          />
          <MacroBar label="Fats" current={totals.consumed_fats} target={targets.fats} colorClass="bg-cyan-400/90" />
        </div>

        <p className="flex items-start gap-2 rounded-2xl border border-amber-500/15 bg-amber-500/5 px-3 py-2.5 text-[13px] leading-snug text-amber-100/90">
          <span className="mt-0.5 text-amber-400" aria-hidden>
            ✨
          </span>
          <span>
            <span className="font-medium text-amber-200/95">AI suggestion:</span> {insightText}
          </span>
        </p>
      </section>

      {pendingSuggestion ? (
        <section className="mb-4 rounded-[24px] border border-cyan-500/25 bg-[#12121a] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-cyan-400/90">Suggested meal</p>
          <p className="mt-2 text-[16px] font-semibold text-white">{pendingSuggestion.name}</p>
          <p className="mt-1 text-[13px] text-zinc-400">
            ~{pendingSuggestion.calories} kcal · {pendingSuggestion.protein}P · {pendingSuggestion.carbs}C ·{' '}
            {pendingSuggestion.fats}F
          </p>
          {pendingSuggestion.suggestion ? (
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{pendingSuggestion.suggestion}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={logSuggestedMeal}
              className="rounded-full bg-gradient-to-r from-cyan-400 to-blue-600 px-5 py-2.5 text-[14px] font-semibold text-[#0a0a0f]"
            >
              Log this meal
            </button>
            <button
              type="button"
              onClick={() => setPendingSuggestion(null)}
              className="rounded-full border border-white/20 px-5 py-2.5 text-[14px] font-medium text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      <ul className="space-y-3">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-stretch gap-3 rounded-2xl border border-white/10 bg-[#12121a] p-3.5"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-300">
              {it.sourceType === 'meal' ? <IconUtensils className="h-5 w-5" /> : <IconPulse className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-snug text-white">{it.name}</p>
              <p className="mt-1 text-[12px] text-zinc-600">{formatTime(it.createdAt)}</p>
              {it.sourceType === 'meal' ? (
                <p className="mt-1 text-[13px] text-zinc-500">
                  {it.calories} kcal · {it.protein}P · {it.carbs}C · {it.fats}F
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-cyan-400/90">Burned ~{it.burned_calories} kcal</p>
              )}
              {it.message ? <p className="mt-1 text-[13px] leading-snug text-zinc-400">{it.message}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => removeItem(it.id)}
              className="self-center rounded-xl p-2 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
              aria-label="Remove entry"
            >
              <IconTrash />
            </button>
          </li>
        ))}
      </ul>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+max(0.75rem,env(safe-area-inset-bottom)))] z-[45] flex justify-center px-4 pb-2">
        <div className="pointer-events-auto w-full max-w-[398px] space-y-2">
          {statusLabel ? (
            <p className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-center text-[13px] font-medium text-cyan-100/95 backdrop-blur-sm">
              {statusLabel}
            </p>
          ) : null}
          {transcriptPreview ? (
            <p className="rounded-2xl border border-white/10 bg-[#0a0a0f]/90 px-3 py-2 text-center text-[13px] italic text-zinc-300 backdrop-blur-sm">
              &ldquo;{transcriptPreview}&rdquo;
            </p>
          ) : null}
          {aiMessage ? (
            <p className="rounded-2xl border border-white/10 bg-[#0a0a0f]/90 px-3 py-2 text-center text-[13px] leading-snug text-zinc-300 backdrop-blur-sm">
              {aiMessage}
            </p>
          ) : null}
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#12121a]/95 px-2 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <button
              type="button"
              onClick={toggleVoice}
              disabled={voicePhase === 'transcribing' || loading}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#0a0a0f] ${
                voicePhase === 'recording' ? 'animate-pulse bg-cyan-300' : 'bg-gradient-to-br from-cyan-400 to-blue-600'
              } disabled:opacity-40`}
              aria-label={voicePhase === 'recording' ? 'Stop recording' : 'Start voice recording'}
            >
              <IconMic className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handlePickPhoto}
              disabled={voiceBusy || !hasApiKey}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
              aria-label="Upload photo"
            >
              <IconCamera />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Log a meal, workout…"
              disabled={voiceBusy}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-zinc-600 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={voiceBusy || !draft.trim() || !hasApiKey}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-[#0a0a0f] disabled:opacity-40"
              aria-label="Send"
            >
              <IconSend />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
