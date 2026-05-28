import { useMemo, useState } from 'react'
import { IconMic } from '../components/Icons.jsx'

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'pl', label: 'Polish' },
  { value: 'es', label: 'Spanish' },
]

function compactLines(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n')
    .trim()
}

function removeNoiseBlocks(text) {
  const lines = text.split('\n')
  const kept = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const lowered = line.toLowerCase()
    if (!line) {
      kept.push(rawLine)
      continue
    }
    if (
      lowered.includes('confidential') ||
      lowered.includes('intended recipient') ||
      lowered.includes('virus') ||
      lowered.includes('privileged and confidential') ||
      lowered.startsWith('sent from my iphone') ||
      lowered.startsWith('sent from my mobile')
    ) {
      continue
    }
    if (/^_{5,}$/.test(line) || /^-{5,}$/.test(line)) continue
    kept.push(rawLine)
  }
  return kept.join('\n')
}

function splitThreadNewestFirst(threadText) {
  const normalized = threadText.replace(/\r\n/g, '\n').trim()
  const parts = normalized
    .split(/\n(?:-{5,}|\s*From: |\s*On .+wrote:|\s*-----Original Message-----)/gi)
    .map((p) => compactLines(removeNoiseBlocks(p)))
    .filter(Boolean)
  return parts
}

function detectLatestSender(section) {
  const fromLine = section
    .split('\n')
    .find((line) => /^(from|nadawca)\s*:/i.test(line.trim()))
  if (fromLine) return fromLine.split(':').slice(1).join(':').trim()
  const first = section.split('\n').find((line) => line.trim())
  return first?.slice(0, 60) || 'Latest sender'
}

function detectReplyTo(section) {
  const toLine = section
    .split('\n')
    .find((line) => /^(to|do)\s*:/i.test(line.trim()))
  if (toLine) return toLine.split(':').slice(1).join(':').trim()
  return 'Thread participants'
}

export function cleanThread(threadText) {
  const sections = splitThreadNewestFirst(threadText)
  const latestSection = sections[0] || ''
  const contextSections = sections.slice(1)
  const dedupedContext = [...new Set(contextSections.map((s) => s.slice(0, 280)))].filter(Boolean)
  return {
    sections,
    latestSection,
    contextSections,
    cleanedThread: compactLines([latestSection, ...contextSections].filter(Boolean).join('\n\n---\n\n')),
    latestSender: detectLatestSender(latestSection),
    replyTo: detectReplyTo(latestSection),
    contextCount: dedupedContext.length,
  }
}

function tr(language, key) {
  const dict = {
    en: {
      subjectTopic: 'Subject / Topic',
      conversationSummary: 'Conversation Summary',
      latestUpdate: 'Latest Update',
      keyPoints: 'Key points',
      changes: 'Changes',
      actionItems: 'Action items',
      replyTarget: 'Reply Target',
      none: 'None detected',
    },
    pl: {
      subjectTopic: 'Temat',
      conversationSummary: 'Podsumowanie rozmowy',
      latestUpdate: 'Najnowsza aktualizacja',
      keyPoints: 'Kluczowe punkty',
      changes: 'Zmiany',
      actionItems: 'Dzialania',
      replyTarget: 'Cel odpowiedzi',
      none: 'Brak',
    },
    es: {
      subjectTopic: 'Tema',
      conversationSummary: 'Resumen de la conversacion',
      latestUpdate: 'Ultima actualizacion',
      keyPoints: 'Puntos clave',
      changes: 'Cambios',
      actionItems: 'Acciones',
      replyTarget: 'Destino de respuesta',
      none: 'No detectado',
    },
  }
  return dict[language]?.[key] || dict.en[key]
}

function isHeaderLine(line) {
  return /^(from|to|cc|subject|date|sent)\s*:/i.test(line)
}

function isGreetingOrSignoff(line) {
  return /^(hi|hello|dear|thanks|thank you|best|regards|pozdrawiam|cześć|hola)\b/i.test(line.trim())
}

function extractSubject(cleaned) {
  const lines = cleaned.cleanedThread.split('\n').map((l) => l.trim())
  const subjectLine = lines.find((line) => /^subject\s*:/i.test(line))
  if (subjectLine) return subjectLine.split(':').slice(1).join(':').trim()
  const candidate = lines.find((line) => line && !isHeaderLine(line) && !isGreetingOrSignoff(line))
  return (candidate || 'Ongoing email thread').slice(0, 120)
}

function extractMeaningfulLines(section, limit = 5) {
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => !isHeaderLine(line))
    .filter((line) => !isGreetingOrSignoff(line))
    .filter((line) => line.length > 8)
    .slice(0, limit)
}

function uniqueLines(lines, max = 6) {
  const seen = new Set()
  const out = []
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= max) break
  }
  return out
}

export function generateSummary(cleaned, language = 'en') {
  const sections = cleaned.sections || []
  const latestSection = cleaned.latestSection || ''
  const historySections = cleaned.contextSections || []

  const subjectTopic = extractSubject(cleaned)
  const latestLines = extractMeaningfulLines(latestSection, 4)
  const historyLines = uniqueLines(historySections.flatMap((s) => extractMeaningfulLines(s, 2)), 6)
  const allLines = uniqueLines([...latestLines, ...historyLines], 10)

  const conversationSummary =
    allLines.join(' ').slice(0, 420) ||
    (cleaned.cleanedThread || '').split('\n').filter((l) => l.trim()).slice(0, 4).join(' ').slice(0, 420)
  const latestUpdate = latestLines.join(' ').slice(0, 260) || tr(language, 'none')

  const keyPoints = uniqueLines(
    allLines.filter((line) =>
      /deadline|deliver|shipment|order|budget|material|responsib|approve|decision|meeting|schedule|confirm|question|request|action|depends|blocker|timeline|owner/i.test(
        line,
      ),
    ),
    6,
  )

  const changes = uniqueLines(
    latestLines.filter((line) =>
      /changed|updated|new|instead|moved|rescheduled|delay|revised|added|copied|cc|constraint|issue|risk/i.test(line),
    ),
    4,
  )

  const actionItems = uniqueLines(
    allLines.filter((line) => /please|need|by |asap|confirm|action|required|can you|could you|reply|send|share|provide/i.test(line)),
    5,
  )

  const latestMainRequest =
    latestLines.find((line) => /please|need|can you|could you|confirm|reply|send|share|provide/i.test(line)) ||
    latestLines[0] ||
    tr(language, 'none')

  const replyTarget = `${cleaned.replyTo || 'Thread participants'} — ${latestMainRequest}`

  return {
    subjectTopic,
    conversationSummary,
    latestUpdate,
    keyPoints: keyPoints.length ? keyPoints : [tr(language, 'none')],
    changes: changes.length ? changes : [tr(language, 'none')],
    actionItems: actionItems.length ? actionItems : [tr(language, 'none')],
    latestSender: cleaned.latestSender,
    replyTo: cleaned.replyTo,
    sectionCount: sections.length,
    labels: {
      subjectTopic: tr(language, 'subjectTopic'),
      conversationSummary: tr(language, 'conversationSummary'),
      latestUpdate: tr(language, 'latestUpdate'),
      keyPoints: tr(language, 'keyPoints'),
      changes: tr(language, 'changes'),
      actionItems: tr(language, 'actionItems'),
      replyTarget: tr(language, 'replyTarget'),
    },
  }
}

export function generateDraft(cleaned, replyIntention, language = 'en') {
  const intent = replyIntention.trim()
  const topContext = (cleaned.latestSection || cleaned.cleanedThread || '').split('\n').slice(0, 8).join(' ')
  const languageLine =
    language === 'pl'
      ? 'Write the email in Polish.'
      : language === 'es'
        ? 'Write the email in Spanish.'
        : 'Write the email in English.'

  return [
    `Hi ${cleaned.latestSender || ''},`,
    '',
    `${languageLine} Thanks for the update.`,
    `Regarding your latest message: ${topContext.slice(0, 180)}${topContext.length > 180 ? '...' : ''}`,
    `${intent}`,
    '',
    'Please let me know if anything else is needed.',
    '',
    'Best regards,',
    '[Your Name]',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

export function refineDraft(cleaned, currentDraft, refinementInstruction, language = 'en') {
  const instruction = refinementInstruction.trim()
  let draft = currentDraft.trim()
  if (/short|shorter|krocej|krócej|mas corto|mas breve/i.test(instruction)) {
    draft = draft
      .split('\n')
      .filter((line) => !/Regarding your latest message/i.test(line))
      .join('\n')
  }
  if (/formal|bardziej formal|formal/i.test(instruction)) {
    draft = draft.replace(/^Hi\b/m, 'Dear').replace(/Best regards,/m, 'Sincerely,')
  }
  if (/warm|warmer|cieplej|amable|calido/i.test(instruction)) {
    draft = draft.replace(/Please let me know if anything else is needed\./, 'Happy to help further if useful.')
  }
  if (/polish|po polsku|polski/i.test(instruction) || language === 'pl') {
    draft = draft.replace('Best regards,', 'Pozdrawiam,')
  }
  if (/spanish|espanol|español/i.test(instruction) || language === 'es') {
    draft = draft.replace('Best regards,', 'Saludos,')
  }
  if (!draft.includes(instruction) && /add|dodaj|añade|include|uwzglednij/i.test(instruction)) {
    draft = `${draft}\n\n${instruction}`
  }
  if (!draft) {
    draft = generateDraft(cleaned, refinementInstruction, language)
  }
  return draft
}

export default function MailAssistant() {
  const [thread, setThread] = useState('')
  const [summaryLanguage, setSummaryLanguage] = useState('en')
  const [replyIntention, setReplyIntention] = useState('')
  const [refineInput, setRefineInput] = useState('')
  const [cleaned, setCleaned] = useState(null)
  const [summary, setSummary] = useState(null)
  const [draft, setDraft] = useState('')
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')
  const [copyState, setCopyState] = useState('')
  const [isEditingDraft, setIsEditingDraft] = useState(false)

  const canShowWorkflow = Boolean(cleaned)

  const hasThread = useMemo(() => thread.trim().length > 0, [thread])

  async function handleClean() {
    if (!hasThread) {
      setErrorText('Paste an email thread first.')
      return
    }
    setErrorText('')
    setStatusText('Cleaning thread...')
    await new Promise((r) => setTimeout(r, 200))
    const cleanedThread = cleanThread(thread)
    setCleaned(cleanedThread)
    setStatusText('Generating summary...')
    await new Promise((r) => setTimeout(r, 200))
    setSummary(generateSummary(cleanedThread, summaryLanguage))
    setDraft('')
    setStatusText('')
  }

  async function handleLanguageChange(nextLanguage) {
    setSummaryLanguage(nextLanguage)
    if (!cleaned) return
    setStatusText('Generating summary...')
    await new Promise((r) => setTimeout(r, 180))
    setSummary(generateSummary(cleaned, nextLanguage))
    setStatusText('')
  }

  async function handleGenerateDraft() {
    if (!hasThread) {
      setErrorText('Paste an email thread first.')
      return
    }
    if (!replyIntention.trim()) {
      setErrorText('Add your reply intention first.')
      return
    }
    setErrorText('')
    const activeCleaned = cleaned || cleanThread(thread)
    if (!cleaned) {
      setCleaned(activeCleaned)
      setSummary(generateSummary(activeCleaned, summaryLanguage))
    }
    setStatusText('Generating draft...')
    await new Promise((r) => setTimeout(r, 220))
    setDraft(generateDraft(activeCleaned, replyIntention, summaryLanguage))
    setIsEditingDraft(false)
    setStatusText('')
  }

  async function handleRefineDraft() {
    if (!refineInput.trim()) {
      setErrorText('Add revision instructions first.')
      return
    }
    if (!draft.trim()) {
      setErrorText('Generate a draft first.')
      return
    }
    if (!cleaned) return
    setErrorText('')
    setStatusText('Applying changes...')
    await new Promise((r) => setTimeout(r, 220))
    setDraft(refineDraft(cleaned, draft, refineInput, summaryLanguage))
    setRefineInput('')
    setStatusText('')
  }

  async function handleCopyDraft() {
    if (!draft.trim()) return
    try {
      await navigator.clipboard.writeText(draft)
      setCopyState('Copied')
      setTimeout(() => setCopyState(''), 1500)
    } catch {
      setCopyState('Copy failed')
      setTimeout(() => setCopyState(''), 1500)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Mail</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Mail Assistant</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
          Paste your thread. I&apos;ll clean, summarize and draft. You copy and send.
        </p>
      </header>

      <section className="space-y-4 rounded-[24px] border border-white/10 bg-[#12121a] p-5">
        <textarea
          value={thread}
          onChange={(e) => setThread(e.target.value)}
          rows={10}
          placeholder="Paste full email thread here…"
          className="w-full resize-none rounded-2xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-cyan-500/30"
        />
        <button
          type="button"
          onClick={handleClean}
          className="w-full rounded-full bg-gradient-to-r from-[#7b91ff] to-[#29d8ff] py-3.5 text-[15px] font-semibold text-[#0a0a0f] shadow-[0_12px_32px_rgba(41,216,255,0.25)] transition hover:brightness-105 active:brightness-95"
        >
          Clean Thread
        </button>
      </section>

      {statusText ? (
        <p className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2.5 text-[13px] text-cyan-100">{statusText}</p>
      ) : null}
      {errorText ? (
        <p className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-[13px] text-rose-100">{errorText}</p>
      ) : null}

      {canShowWorkflow ? (
        <div className="space-y-4">
          <section className="rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Summary</p>
              <select
                value={summaryLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="rounded-lg border border-white/15 bg-[#1a1a24] px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-[12px] text-zinc-500">
              Latest sender: {summary?.latestSender || 'Unknown'} · Replying to: {summary?.replyTo || 'Thread'} ·{' '}
              {summary?.sectionCount || 0} messages detected
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {summary?.labels.subjectTopic}
                </p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-200">{summary?.subjectTopic}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {summary?.labels.conversationSummary}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{summary?.conversationSummary}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {summary?.labels.latestUpdate}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{summary?.latestUpdate}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {summary?.labels.keyPoints}
                </p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-zinc-300">
                  {summary?.keyPoints.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{summary?.labels.changes}</p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-zinc-300">
                  {summary?.changes.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{summary?.labels.actionItems}</p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-zinc-300">
                  {summary?.actionItems.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{summary?.labels.replyTarget}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{summary?.replyTarget}</p>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Your reply intention</p>
            <div className="flex items-end gap-2">
              <textarea
                value={replyIntention}
                onChange={(e) => setReplyIntention(e.target.value)}
                rows={4}
                placeholder="Type what you want to say…"
                className="w-full resize-none rounded-2xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-cyan-500/30"
              />
              <button
                type="button"
                disabled
                className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#1a1a24] text-zinc-500"
                aria-label="Voice intention (coming soon)"
              >
                <IconMic className="h-5 w-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleGenerateDraft}
              className="w-full rounded-full bg-gradient-to-r from-[#7b91ff] to-[#29d8ff] py-3 text-[15px] font-semibold text-[#0a0a0f]"
            >
              Generate Draft
            </button>
          </section>

          <section className="rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Draft Reply</p>
            {isEditingDraft ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] leading-relaxed text-white outline-none"
              />
            ) : (
              <pre className="mt-3 whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-zinc-200">
                {draft || 'Generate a draft to see it here.'}
              </pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyDraft}
                disabled={!draft}
                className="rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-zinc-200 disabled:opacity-40"
              >
                {copyState || 'Copy'}
              </button>
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={!replyIntention.trim() || !hasThread}
                className="rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-zinc-200 disabled:opacity-40"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => setIsEditingDraft((v) => !v)}
                disabled={!draft}
                className="rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-zinc-200 disabled:opacity-40"
              >
                {isEditingDraft ? 'Done Editing' : 'Edit Manually'}
              </button>
            </div>
          </section>

          <section className="space-y-3 rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Refine draft</p>
            <textarea
              value={refineInput}
              onChange={(e) => setRefineInput(e.target.value)}
              rows={3}
              placeholder="Tell AI what to change…"
              className="w-full resize-none rounded-2xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-cyan-500/30"
            />
            <button
              type="button"
              onClick={handleRefineDraft}
              className="w-full rounded-full bg-gradient-to-r from-[#7b91ff] to-[#29d8ff] py-3 text-[15px] font-semibold text-[#0a0a0f]"
            >
              Apply Changes
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}
