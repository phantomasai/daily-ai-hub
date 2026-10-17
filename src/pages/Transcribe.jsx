import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SAFE_UPLOAD_BYTES, isAcceptedAudioFile } from '../audioSegment.js'
import { isM4aLikeFile } from '../m4aRemuxSplit.js'
import { DAY_KEYS, getTodayDayKey } from '../todoDays.js'
import { addApprovedTasks } from '../todoStorage.js'
import { AudioDecodeError, transcribeAudioFile } from '../transcribeFile.js'
import { extractTasksFromTranscript } from '../transcriptTasks.js'

const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect (mixed OK)' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'pl', label: 'Polish' },
]

const ACCEPT = '.m4a,.mp3,.wav,.mp4,.webm,audio/*,video/mp4,video/webm'

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return null
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export default function Transcribe() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(/** @type {File | null} */ (null))
  const [language, setLanguage] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(/** @type {string} */ (''))
  const [progressPct, setProgressPct] = useState(0)
  const [error, setError] = useState('')
  const [blocker, setBlocker] = useState('')
  const [transcript, setTranscript] = useState('')
  const [meta, setMeta] = useState(
    /** @type {{ strategy?: string, durationSec?: number | null, partial?: boolean, errors?: string[], partsOk?: number, partsTotal?: number } | null} */ (
      null
    ),
  )
  const [copyToast, setCopyToast] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [candidates, setCandidates] = useState(/** @type {import('../transcriptTasks.js').TranscriptTaskCandidate[]} */ ([]))
  const [extractError, setExtractError] = useState('')
  const [todoToast, setTodoToast] = useState('')

  function resetResults() {
    setTranscript('')
    setMeta(null)
    setCandidates([])
    setExtractError('')
    setTodoToast('')
    setBlocker('')
    setError('')
    setProgress('')
    setProgressPct(0)
  }

  function onPickFile(next) {
    resetResults()
    if (!next) {
      setFile(null)
      return
    }
    if (!isAcceptedAudioFile(next)) {
      setFile(null)
      setError('Unsupported type. Use .m4a, .mp3, .wav, .mp4, or .webm.')
      return
    }
    setFile(next)
  }

  async function runTranscribe() {
    if (!file || busy) return
    setBusy(true)
    setError('')
    setBlocker('')
    setTranscript('')
    setMeta(null)
    setCandidates([])
    setExtractError('')
    setTodoToast('')
    setProgress('Starting…')
    setProgressPct(2)

    try {
      const result = await transcribeAudioFile(file, {
        language,
        onProgress: (info) => {
          const msg = typeof info.message === 'string' ? info.message : info.stage || ''
          setProgress(msg)
          if (info.stage === 'prepare' && info.phase === 'decoding') setProgressPct(8)
          else if (info.stage === 'prepare' && info.phase === 'segmenting' && info.total) {
            setProgressPct(8 + Math.round((30 * (info.current || 0)) / info.total))
          } else if (info.stage === 'transcribe' && info.total) {
            setProgressPct(40 + Math.round((55 * (info.current || 0)) / info.total))
          } else if (info.stage === 'done') setProgressPct(100)
        },
      })

      setTranscript(result.transcript)
      const partsOk = result.parts.filter((p) => p.status === 'ok').length
      setMeta({
        strategy: result.strategy,
        durationSec: result.durationSec,
        partial: result.partial,
        errors: result.errors,
        partsOk,
        partsTotal: result.parts.length,
      })
      if (result.partial) {
        setError(
          `Completed with ${result.errors.length} failed segment(s). Failed parts are marked in the transcript — nothing was silently dropped.`,
        )
      }
      setProgress(result.partial ? 'Done (partial).' : 'Done.')
      setProgressPct(100)
    } catch (err) {
      if (err instanceof AudioDecodeError) {
        setBlocker(err.message)
        setError('')
      } else {
        setError(err instanceof Error ? err.message : 'Transcription failed.')
      }
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  async function copyTranscript() {
    if (!transcript) return
    try {
      await navigator.clipboard.writeText(transcript)
      setCopyToast('Copied')
      setTimeout(() => setCopyToast(''), 2000)
    } catch {
      setCopyToast('Copy failed')
      setTimeout(() => setCopyToast(''), 2000)
    }
  }

  function exportTxt() {
    if (!transcript) return
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function runExtractTasks() {
    if (!transcript.trim() || extracting) return
    setExtracting(true)
    setExtractError('')
    setTodoToast('')
    try {
      const list = await extractTasksFromTranscript(transcript)
      setCandidates(list)
      if (!list.length) setExtractError('No explicit action items found in this transcript.')
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Could not extract tasks.')
      setCandidates([])
    } finally {
      setExtracting(false)
    }
  }

  function updateCandidate(id, patch) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addSelectedToTodo() {
    const selected = candidates.filter((c) => c.selected && c.title.trim())
    if (!selected.length) {
      setTodoToast('Select at least one task.')
      return
    }
    const { added, skipped } = addApprovedTasks(
      selected.map((c) => ({
        title: c.title.trim(),
        note: c.note || '',
        day: c.day || getTodayDayKey(),
        selected: true,
      })),
    )
    const bits = []
    if (added.length) bits.push(`Added ${added.length}`)
    if (skipped.length) bits.push(`skipped ${skipped.length} duplicate(s)`)
    setTodoToast(bits.join(', ') || 'Nothing to add.')
  }

  const needsSegmentHint = Boolean(file && file.size > SAFE_UPLOAD_BYTES)
  const isM4aHint = Boolean(file && isM4aLikeFile(file))

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Transcribe</p>
        <h1 className="text-2xl font-bold tracking-tight text-white">Voice memos & meetings</h1>
        <p className="text-[14px] leading-relaxed text-zinc-500">
          Import Apple Voice Memos or meeting audio. Mixed English, Spanish, and Polish stay in the original
          languages — never translated. Audio and transcripts stay in this session only.
        </p>
      </header>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-[#12121a] p-4">
        <div>
          <label className="text-[12px] font-medium text-zinc-400">Audio file</label>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="mt-2 block w-full text-[13px] text-zinc-300 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/20 file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-cyan-200"
            disabled={busy}
            onChange={(e) => onPickFile(e.target.files?.[0] || null)}
          />
          {file ? (
            <p className="mt-2 text-[12px] text-zinc-500">
              {file.name} · {formatBytes(file.size)}
              {needsSegmentHint
                ? isM4aHint
                  ? ' · will remux AAC into ~6 min M4A parts (no full PCM)'
                  : ' · will split for Vercel upload limits'
                : ' · single upload'}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-zinc-600">.m4a, .mp3, .wav, .mp4, .webm</p>
          )}
        </div>

        <div>
          <label htmlFor="transcribe-lang" className="text-[12px] font-medium text-zinc-400">
            Language
          </label>
          <select
            id="transcribe-lang"
            value={language}
            disabled={busy}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0a0a0f] px-3 py-2.5 text-[14px] text-white outline-none focus:border-cyan-500/40"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] text-zinc-600">
            Auto-detect preserves mixed speech. Manual force is optional when the recording is mostly one language.
          </p>
        </div>

        <button
          type="button"
          disabled={!file || busy}
          onClick={() => void runTranscribe()}
          className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 px-4 py-3 text-[15px] font-semibold text-[#0a0a0f] transition hover:opacity-95 disabled:opacity-40"
        >
          {busy ? 'Transcribing…' : 'Transcribe'}
        </button>

        {busy || progress ? (
          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
            {progress ? <p className="text-[12px] text-cyan-300/90">{progress}</p> : null}
          </div>
        ) : null}

        {blocker ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[13px] leading-relaxed text-amber-100/90">
            <p className="font-medium text-amber-200">Long-file decode blocked</p>
            <p className="mt-1.5">{blocker}</p>
          </div>
        ) : null}

        {error ? (
          <p className="text-[13px] leading-snug text-amber-200/90">
            {error}
            {error.includes('API key') ? (
              <>
                {' '}
                <Link to="/settings" className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
                  Settings
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      {transcript ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-white">Full Transcript</h2>
              {meta ? (
                <p className="mt-1 text-[12px] text-zinc-500">
                  {meta.strategy === 'remuxed'
                    ? 'M4A remux (AAC copy)'
                    : meta.strategy === 'segmented'
                      ? 'Short WAV fallback'
                      : 'Direct upload'}
                  {meta.durationSec != null ? ` · ${formatDuration(meta.durationSec)}` : ''}
                  {meta.partsTotal != null ? ` · ${meta.partsOk}/${meta.partsTotal} segments OK` : ''}
                  {meta.partial ? ' · partial' : ''}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyTranscript()}
                className="rounded-xl border border-white/10 bg-[#12121a] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:border-cyan-500/30"
              >
                {copyToast || 'Copy'}
              </button>
              <button
                type="button"
                onClick={exportTxt}
                className="rounded-xl border border-white/10 bg-[#12121a] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:border-cyan-500/30"
              >
                Export TXT
              </button>
            </div>
          </div>

          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            className="w-full resize-y rounded-2xl border border-white/10 bg-[#12121a] px-3 py-3 text-[14px] leading-relaxed text-zinc-200 outline-none focus:border-cyan-500/35"
            spellCheck
          />

          {meta?.errors?.length ? (
            <ul className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-100/80">
              {meta.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {transcript ? (
        <section className="space-y-3 rounded-2xl border border-white/10 bg-[#12121a] p-4">
          <div>
            <h2 className="text-[15px] font-semibold text-white">Quick Actions</h2>
            <p className="mt-1 text-[12px] text-zinc-500">
              Optional. Extract candidate tasks from the full transcript — never runs automatically. You approve
              before anything is added to To Do.
            </p>
          </div>

          <button
            type="button"
            disabled={extracting || !transcript.trim()}
            onClick={() => void runExtractTasks()}
            className="rounded-2xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2.5 text-[14px] font-medium text-cyan-200 transition hover:bg-cyan-500/15 disabled:opacity-40"
          >
            {extracting ? 'Extracting…' : 'Extract Tasks'}
          </button>

          {extractError ? <p className="text-[13px] text-amber-200/90">{extractError}</p> : null}

          {candidates.length ? (
            <div className="space-y-3">
              <ul className="space-y-3">
                {candidates.map((c) => (
                  <li key={c.id} className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={c.selected}
                        onChange={(e) => updateCandidate(c.id, { selected: e.target.checked })}
                        className="mt-1 h-4 w-4 accent-cyan-400"
                        aria-label="Select task"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          type="text"
                          value={c.title}
                          onChange={(e) => updateCandidate(c.id, { title: e.target.value })}
                          className="w-full rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-[14px] text-white outline-none focus:border-cyan-500/40"
                        />
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={c.day}
                            onChange={(e) => updateCandidate(c.id, { day: e.target.value })}
                            className="rounded-lg border border-white/10 bg-[#12121a] px-2 py-1.5 text-[12px] text-zinc-300 outline-none"
                          >
                            {DAY_KEYS.map((d) => (
                              <option key={d} value={d}>
                                {DAY_LABELS[d]}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={c.note}
                            onChange={(e) => updateCandidate(c.id, { note: e.target.value })}
                            placeholder="Note (optional)"
                            className="min-w-[8rem] flex-1 rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-[12px] text-zinc-400 outline-none focus:border-cyan-500/40"
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={addSelectedToTodo}
                className="w-full rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 px-4 py-2.5 text-[14px] font-semibold text-[#0a0a0f]"
              >
                Add selected to To Do
              </button>
              {todoToast ? <p className="text-[13px] text-cyan-200/90">{todoToast}</p> : null}
              <p className="text-[12px] text-zinc-600">
                Opens in{' '}
                <Link to="/todo" className="text-cyan-300 underline-offset-2 hover:underline">
                  To Do
                </Link>{' '}
                after you approve.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Uploads go through the existing <code className="text-zinc-500">/api/transcribe</code> proxy using your
        Settings key. Final multipart bodies stay under Vercel Edge ~4 MB. Large Apple Voice Memos are split with
        lossless AAC remux (~6 min M4A parts). Full-meeting PCM decode is not used.
      </p>
    </div>
  )
}
