import { useEffect, useMemo, useRef, useState } from 'react'
import { IconMic } from '../components/Icons.jsx'
import { cleanApiKeyForHttp, getAiSettings } from '../aiService.js'
import { createVoiceRecorder, getVoiceStatusLabel, isAudioRecordingSupported } from '../trackerAudio.js'

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'pl', label: 'Polish' },
  { value: 'es', label: 'Spanish' },
]
const DRAFT_LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  ...LANGUAGE_OPTIONS,
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
      latestUpdate: 'Latest Update',
      keyPoints: 'Key points',
      changes: 'Changes / Updates',
      awaitingOpenItems: 'Awaiting / Open Items',
      suggestedReplyFocus: 'Suggested Reply Focus',
      none: 'None detected',
      notClear: 'Not clear from thread',
      initialStage: 'Initial stage',
      then: 'Then',
      latest: 'Latest',
      latestSender: 'Latest sender',
      replyingTo: 'Replying to',
      messagesDetected: 'messages detected',
    },
    pl: {
      subjectTopic: 'Temat',
      latestUpdate: 'Najnowsza aktualizacja',
      keyPoints: 'Kluczowe punkty',
      changes: 'Zmiany',
      awaitingOpenItems: 'Otwarte kwestie',
      suggestedReplyFocus: 'Sugerowany kierunek odpowiedzi',
      none: 'Brak',
      notClear: 'Nie wynika jasno z watku',
      initialStage: 'Etap poczatkowy',
      then: 'Nastepnie',
      latest: 'Najnowsze',
      latestSender: 'Nadawca najnowszej wiadomosci',
      replyingTo: 'Odpowiedz do',
      messagesDetected: 'wykrytych wiadomosci',
    },
    es: {
      subjectTopic: 'Tema',
      latestUpdate: 'Ultima actualizacion',
      keyPoints: 'Puntos clave',
      changes: 'Cambios',
      awaitingOpenItems: 'Pendientes / Abiertos',
      suggestedReplyFocus: 'Enfoque sugerido de respuesta',
      none: 'No detectado',
      notClear: 'No queda claro en el hilo',
      initialStage: 'Etapa inicial',
      then: 'Luego',
      latest: 'Ultimo',
      latestSender: 'Remitente mas reciente',
      replyingTo: 'Responder a',
      messagesDetected: 'mensajes detectados',
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

function normalizeFact(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortLine(text, max = 160) {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trim()}…` : cleaned
}

function localizeProgressLine(text, idx, total, language) {
  const line = shortLine(text)
  if (language === 'en') {
    if (idx === 0) return `${tr(language, 'initialStage')}: ${line}`
    if (idx === total - 1) return `${tr(language, 'latest')}: ${line}`
    return `${tr(language, 'then')}: ${line}`
  }
  if (language === 'pl') {
    if (idx === 0) return `${tr(language, 'initialStage')}: ${line}`
    if (idx === total - 1) return `${tr(language, 'latest')}: ${line}`
    return `${tr(language, 'then')}: ${line}`
  }
  if (idx === 0) return `${tr(language, 'initialStage')}: ${line}`
  if (idx === total - 1) return `${tr(language, 'latest')}: ${line}`
  return `${tr(language, 'then')}: ${line}`
}

function localizeReplyFocus(line, language) {
  const item = shortLine(line)
  if (language === 'pl') return `Odpowiedz na: ${item}`
  if (language === 'es') return `Responder a: ${item}`
  return `Reply to: ${item}`
}

function extractAwaitingLines(lines) {
  return lines.filter((line) =>
    /pending|await|not clear|unclear|question|\?|confirm|availability|schedule|date|deadline|when|who|owner|needs|need|request|advise|reply/i.test(
      line,
    ),
  )
}

export function generateThreadBrief(threadText, language = 'en') {
  const cleaned = cleanThread(threadText)
  const subjectTopic = extractSubject(cleaned)
  const none = tr(language, 'notClear')

  const latestLines = uniqueLines(extractMeaningfulLines(cleaned.latestSection || '', 8).map((x) => shortLine(x)), 8)
  const historyOldestToNewest = [...(cleaned.contextSections || [])].reverse()
  const historyLines = uniqueLines(historyOldestToNewest.flatMap((s) => extractMeaningfulLines(s, 2).map((x) => shortLine(x))), 12)

  const latestUpdate = uniqueLines(latestLines, 2)
  const latestNorm = new Set(latestUpdate.map(normalizeFact))

  const keyPointsRaw = uniqueLines(
    [...historyLines, ...latestLines].filter((line) => {
      const norm = normalizeFact(line)
      if (latestNorm.has(norm)) return false
      return /quote|order|project|approved|accepted|material|delivery|schedule|date|budget|meeting|owner|responsib|pending|question|request|deadline|shipment|install|works|availability/i.test(
        line,
      )
    }),
    7,
  )

  const timelineRaw = []
  for (const section of historyOldestToNewest) {
    const event = extractMeaningfulLines(section, 1)[0]
    if (event) timelineRaw.push(shortLine(event))
  }
  const latestEvent = latestLines[0]
  if (latestEvent) timelineRaw.push(shortLine(latestEvent))
  const changesProgression = uniqueLines(timelineRaw, 5).map((line, idx, arr) => localizeProgressLine(line, idx, arr.length, language))

  const awaitingOpenItems = uniqueLines(extractAwaitingLines([...latestLines, ...historyLines]), 3)

  const suggestedReplyFocus = uniqueLines(
    [
      ...extractAwaitingLines(latestLines),
      ...latestUpdate.slice(0, 1),
      ...(awaitingOpenItems.length ? awaitingOpenItems.slice(0, 1) : []),
    ],
    3,
  ).map((line) => localizeReplyFocus(line, language))

  return {
    subjectTopic,
    latestUpdate: latestUpdate.length ? latestUpdate : [none],
    keyPoints: keyPointsRaw.length ? keyPointsRaw : [none],
    changesProgression: changesProgression.length ? changesProgression : [none],
    awaitingOpenItems: awaitingOpenItems.length ? awaitingOpenItems : [none],
    suggestedReplyFocus: suggestedReplyFocus.length ? suggestedReplyFocus : [none],
    latestSender: cleaned.latestSender,
    replyTo: cleaned.replyTo,
    sectionCount: cleaned.sections.length,
  }
}

export function generateSummary(cleaned, language = 'en') {
  const brief = generateThreadBrief(cleaned.cleanedThread || '', language)
  return {
    ...brief,
    latestSender: cleaned.latestSender,
    replyTo: cleaned.replyTo,
    labels: {
      subjectTopic: tr(language, 'subjectTopic'),
      latestUpdate: tr(language, 'latestUpdate'),
      keyPoints: tr(language, 'keyPoints'),
      changes: tr(language, 'changes'),
      awaitingOpenItems: tr(language, 'awaitingOpenItems'),
      suggestedReplyFocus: tr(language, 'suggestedReplyFocus'),
    },
  }
}

function summarySchemaHint() {
  return `Return ONLY valid JSON with this exact shape:
{"subjectTopic":"string","latestUpdate":["string"],"keyPoints":["string"],"changesProgression":["string"],"awaitingOpenItems":["string"],"suggestedReplyFocus":["string"]}
Rules:
- Use the full thread context, newest email at top, older emails as context.
- Keep concise operational business brief.
- latestUpdate max 2 bullets.
- No greetings/signatures/disclaimers.
- No duplicated facts across sections.
- If unclear, use "Not clear from thread" translated to requested language.`
}

function mapLanguageToInstruction(language) {
  if (language === 'pl') return 'Write everything in Polish.'
  if (language === 'es') return 'Write everything in Spanish.'
  return 'Write everything in English.'
}

function detectEmailLanguage(text) {
  const sample = (text || '').toLowerCase()
  const polishScore = (sample.match(/\b(że|czy|oraz|dzień|proszę|potwierdzić|termin|montaż|jutro|odpowiedz)\b/g) || []).length
  const spanishScore = (sample.match(/\b(hola|gracias|por favor|confirmar|instalacion|manana|adjunto|respuesta|correo)\b/g) || []).length
  const englishScore = (sample.match(/\b(hello|thanks|please|confirm|schedule|installation|tomorrow|reply|email)\b/g) || []).length
  if (polishScore >= spanishScore && polishScore >= englishScore && polishScore > 0) return 'pl'
  if (spanishScore >= polishScore && spanishScore >= englishScore && spanishScore > 0) return 'es'
  return 'en'
}

function resolveDraftLanguage(draftLanguage, detectedEmailLanguage) {
  return draftLanguage === 'auto' ? detectedEmailLanguage || 'en' : draftLanguage
}

function maybeStripInstructionPrefix(text) {
  return text
    .trim()
    .replace(
      /^(odpisz(,\s*)?(ze|że)?|napisz(,\s*)?(ze|że)?|odpowiedz(,\s*)?(ze|że)?|reply(,?\s*)?(that)?|say(,?\s*)?(that)?|tell (them|him|her)?(,?\s*)?(that)?|write(,?\s*)?(that)?)\s*/i,
      '',
    )
    .trim()
}

async function callOpenAiJson({ systemPrompt, userPrompt }) {
  const key = cleanApiKeyForHttp(getAiSettings().apiKey)
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers['x-openai-api-key'] = key

  const res = await fetch('/api/openai', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error || data?.message || 'AI request failed.'
    throw new Error(msg)
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty AI response.')
  return JSON.parse(content)
}

async function generateThreadBriefAI(threadText, language) {
  const payload = await callOpenAiJson({
    systemPrompt: [
      'You are an executive email assistant generating practical operational briefs.',
      mapLanguageToInstruction(language),
      summarySchemaHint(),
    ].join('\n'),
    userPrompt: `Thread (newest email first):\n${threadText}`,
  })
  return {
    subjectTopic: String(payload.subjectTopic || '').trim(),
    latestUpdate: Array.isArray(payload.latestUpdate) ? payload.latestUpdate.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 2) : [],
    keyPoints: Array.isArray(payload.keyPoints) ? payload.keyPoints.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 8) : [],
    changesProgression: Array.isArray(payload.changesProgression)
      ? payload.changesProgression.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 6)
      : [],
    awaitingOpenItems: Array.isArray(payload.awaitingOpenItems)
      ? payload.awaitingOpenItems.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 4)
      : [],
    suggestedReplyFocus: Array.isArray(payload.suggestedReplyFocus)
      ? payload.suggestedReplyFocus.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 4)
      : [],
  }
}

async function generateDraftAI({ cleaned, summary, replyIntention, language }) {
  const intent = maybeStripInstructionPrefix(replyIntention)
  const payload = await callOpenAiJson({
    systemPrompt: [
      'You write professional email replies.',
      mapLanguageToInstruction(language),
      'Treat user intention as instruction, NOT literal text to copy.',
      'Never include phrases like "Reply that", "Odpisz że", or internal instructions.',
      'Use full thread context, respond mainly to the latest email.',
      'Do not invent names, dates, promises, or attachments.',
      'Return ONLY valid JSON: {"draft":"string"}',
    ].join('\n'),
    userPrompt: [
      `Latest sender: ${cleaned.latestSender || 'Unknown'}`,
      `Reply target: ${cleaned.replyTo || 'Thread participants'}`,
      `Thread (cleaned):\n${cleaned.cleanedThread}`,
      `Operational brief:\n${JSON.stringify(summary)}`,
      `User reply intention (instruction): ${intent}`,
    ].join('\n\n'),
  })
  const draft = String(payload.draft || '').trim()
  if (!draft) throw new Error('Could not generate draft.')
  return draft
}

export function generateDraft(cleaned, replyIntention, language = 'en') {
  const intent = maybeStripInstructionPrefix(replyIntention)
  const topContext = (cleaned.latestSection || cleaned.cleanedThread || '').split('\n').slice(0, 8).join(' ')
  const greeting = language === 'pl' ? 'Dzień dobry,' : language === 'es' ? 'Hola,' : 'Hi,'
  const thanks = language === 'pl' ? 'Dziękuję za wiadomość.' : language === 'es' ? 'Gracias por su mensaje.' : 'Thank you for the update.'
  const contextLine =
    language === 'pl'
      ? `W nawiązaniu do najnowszej wiadomości: ${topContext.slice(0, 180)}${topContext.length > 180 ? '...' : ''}`
      : language === 'es'
        ? `Respecto al mensaje más reciente: ${topContext.slice(0, 180)}${topContext.length > 180 ? '...' : ''}`
        : `Regarding your latest message: ${topContext.slice(0, 180)}${topContext.length > 180 ? '...' : ''}`
  const closing =
    language === 'pl'
      ? ['Proszę o potwierdzenie, czy to odpowiednie.', '', 'Pozdrawiam,', '[Twoje imię]']
      : language === 'es'
        ? ['Por favor confirme si esto le funciona.', '', 'Saludos,', '[Tu nombre]']
        : ['Please confirm if this works for you.', '', 'Best regards,', '[Your Name]']

  return [
    greeting,
    '',
    thanks,
    contextLine,
    intent ? `${intent.charAt(0).toUpperCase()}${intent.slice(1)}.` : '',
    '',
    ...closing,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function wantsTranslation(instruction) {
  return /translate to (polish|english|spanish)|przetłumacz|po polsku|en español|en espanol/i.test(instruction)
}

async function refineDraftAI({ cleaned, currentDraft, refinementInstruction, language }) {
  const instruction = refinementInstruction.trim()
  const translateRequested = wantsTranslation(instruction)
  const payload = await callOpenAiJson({
    systemPrompt: [
      'You revise professional email drafts based on user instructions.',
      translateRequested
        ? 'Follow explicit translation requests in the revision instructions.'
        : `${mapLanguageToInstruction(language)} Keep the entire revised draft in this language.`,
      'Treat revision input as instructions, NOT literal text to paste into the email.',
      'Never include phrases like "Reply that", "Odpisz że", or the raw instruction text.',
      'Apply only the requested changes. Preserve thread context and existing facts.',
      'Do not invent names, dates, promises, or attachments.',
      'Return ONLY valid JSON: {"draft":"string"}',
    ].join('\n'),
    userPrompt: [
      `Thread (cleaned, newest first):\n${cleaned.cleanedThread}`,
      `Current draft:\n${currentDraft}`,
      `Revision instructions: ${instruction}`,
    ].join('\n\n'),
  })
  const revised = String(payload.draft || '').trim()
  if (!revised) throw new Error('Could not refine draft.')
  return revised
}

export function refineDraft(cleaned, currentDraft, refinementInstruction, language = 'en') {
  const instruction = refinementInstruction.trim()
  let draft = currentDraft.trim()
  if (/short|shorter|krocej|krócej|mas corto|mas breve/i.test(instruction)) {
    draft = draft
      .split('\n')
      .filter((line) => !/Regarding your latest message|W nawiązaniu|Respecto al/i.test(line))
      .join('\n')
  }
  if (/formal|bardziej formal/i.test(instruction)) {
    draft = draft.replace(/^Hi\b/m, 'Dear').replace(/Best regards,/m, 'Sincerely,')
  }
  if (/warm|warmer|cieplej|amable|calido/i.test(instruction)) {
    draft = draft.replace(/Please let me know if anything else is needed\./, 'Happy to help further if useful.')
  }
  if (wantsTranslation(instruction)) {
    if (/polish|po polsku|polski/i.test(instruction)) {
      draft = draft.replace('Best regards,', 'Pozdrawiam,')
    }
    if (/spanish|espanol|español/i.test(instruction)) {
      draft = draft.replace('Best regards,', 'Saludos,')
    }
  }
  if (!draft) {
    draft = generateDraft(cleaned, refinementInstruction, language)
  }
  return draft
}

export default function MailAssistant() {
  const intentionVoiceRef = useRef(null)
  const [thread, setThread] = useState('')
  const [summaryLanguage, setSummaryLanguage] = useState('en')
  const [draftLanguage, setDraftLanguage] = useState('auto')
  const [detectedEmailLanguage, setDetectedEmailLanguage] = useState('en')
  const [replyIntention, setReplyIntention] = useState('')
  const [refineInput, setRefineInput] = useState('')
  const [cleaned, setCleaned] = useState(null)
  const [summary, setSummary] = useState(null)
  const [draft, setDraft] = useState('')
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')
  const [copyState, setCopyState] = useState('')
  const [isEditingDraft, setIsEditingDraft] = useState(false)
  const [intentionVoicePhase, setIntentionVoicePhase] = useState('idle')
  const [intentionVoiceError, setIntentionVoiceError] = useState('')

  const canShowWorkflow = Boolean(cleaned)

  const hasThread = useMemo(() => thread.trim().length > 0, [thread])
  const intentionVoiceStatus = getVoiceStatusLabel(intentionVoicePhase, false)
  const intentionVoiceBusy = intentionVoicePhase !== 'idle'

  function getIntentionVoiceRecorder() {
    if (!intentionVoiceRef.current) {
      intentionVoiceRef.current = createVoiceRecorder({ onPhase: setIntentionVoicePhase })
    }
    return intentionVoiceRef.current
  }

  useEffect(() => {
    return () => intentionVoiceRef.current?.cancel()
  }, [])

  function appendReplyIntention(text) {
    const next = text.trim()
    if (!next) return
    setReplyIntention((prev) => {
      const updated = prev.trim() ? `${prev.trim()}\n${next}` : next
      console.log('[mail] reply intention updated')
      return updated
    })
  }

  async function toggleIntentionVoice() {
    if (intentionVoicePhase === 'transcribing') return

    const rec = getIntentionVoiceRecorder()

    if (intentionVoicePhase === 'recording') {
      setIntentionVoiceError('')
      try {
        const said = await rec.stopAndTranscribe()
        console.log('[mail] Mail mic transcription received:', said)
        appendReplyIntention(said)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transcription failed.'
        setIntentionVoiceError(msg)
        console.log('[mail] transcription failed')
      }
      return
    }

    if (intentionVoicePhase !== 'idle') return

    setIntentionVoiceError('')
    if (!isAudioRecordingSupported()) {
      setIntentionVoiceError('Audio recording is not supported in this browser.')
      return
    }
    try {
      await rec.start()
      console.log('[mail] Mail mic recording started')
    } catch (err) {
      setIntentionVoiceError(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  async function handleClean() {
    if (!hasThread) {
      setErrorText('Paste an email thread first.')
      return
    }
    setErrorText('')
    setStatusText('Cleaning thread...')
    await new Promise((r) => setTimeout(r, 200))
    const cleanedThread = cleanThread(thread)
    const detected = detectEmailLanguage(cleanedThread.latestSection || cleanedThread.cleanedThread || '')
    setDetectedEmailLanguage(detected)
    setCleaned(cleanedThread)
    setStatusText('Generating summary...')
    await new Promise((r) => setTimeout(r, 200))
    try {
      const aiBrief = await generateThreadBriefAI(cleanedThread.cleanedThread, summaryLanguage)
      setSummary({
        ...aiBrief,
        latestSender: cleanedThread.latestSender,
        replyTo: cleanedThread.replyTo,
        sectionCount: cleanedThread.sections.length,
        labels: {
          subjectTopic: tr(summaryLanguage, 'subjectTopic'),
          latestUpdate: tr(summaryLanguage, 'latestUpdate'),
          keyPoints: tr(summaryLanguage, 'keyPoints'),
          changes: tr(summaryLanguage, 'changes'),
          awaitingOpenItems: tr(summaryLanguage, 'awaitingOpenItems'),
          suggestedReplyFocus: tr(summaryLanguage, 'suggestedReplyFocus'),
        },
      })
    } catch {
      setSummary(generateSummary(cleanedThread, summaryLanguage))
    }
    setDraft('')
    setStatusText('')
  }

  async function handleLanguageChange(nextLanguage) {
    setSummaryLanguage(nextLanguage)
    if (!cleaned) return
    setStatusText('Generating summary...')
    await new Promise((r) => setTimeout(r, 180))
    try {
      const aiBrief = await generateThreadBriefAI(cleaned.cleanedThread, nextLanguage)
      setSummary({
        ...aiBrief,
        latestSender: cleaned.latestSender,
        replyTo: cleaned.replyTo,
        sectionCount: cleaned.sections.length,
        labels: {
          subjectTopic: tr(nextLanguage, 'subjectTopic'),
          latestUpdate: tr(nextLanguage, 'latestUpdate'),
          keyPoints: tr(nextLanguage, 'keyPoints'),
          changes: tr(nextLanguage, 'changes'),
          awaitingOpenItems: tr(nextLanguage, 'awaitingOpenItems'),
          suggestedReplyFocus: tr(nextLanguage, 'suggestedReplyFocus'),
        },
      })
    } catch {
      setSummary(generateSummary(cleaned, nextLanguage))
    }
    setStatusText('')
  }

  async function handleDraftLanguageChange(nextLanguage) {
    setDraftLanguage(nextLanguage)
    if (!cleaned || !replyIntention.trim()) return
    const targetLanguage = resolveDraftLanguage(nextLanguage, detectedEmailLanguage)
    setStatusText('Generating draft...')
    await new Promise((r) => setTimeout(r, 180))
    try {
      const activeSummary = summary || generateSummary(cleaned, summaryLanguage)
      const nextDraft = await generateDraftAI({
        cleaned,
        summary: activeSummary,
        replyIntention,
        language: targetLanguage,
      })
      setDraft(nextDraft)
      setIsEditingDraft(false)
    } catch {
      setDraft(generateDraft(cleaned, replyIntention, targetLanguage))
      setIsEditingDraft(false)
    }
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
    const detected = detectEmailLanguage(activeCleaned.latestSection || activeCleaned.cleanedThread || '')
    if (!cleaned) setDetectedEmailLanguage(detected)
    const targetDraftLanguage = resolveDraftLanguage(draftLanguage, detected)
    if (!cleaned) {
      setCleaned(activeCleaned)
      setSummary(generateSummary(activeCleaned, summaryLanguage))
    }
    setStatusText('Generating draft...')
    await new Promise((r) => setTimeout(r, 220))
    try {
      const activeSummary = summary || generateSummary(activeCleaned, summaryLanguage)
      const aiDraft = await generateDraftAI({
        cleaned: activeCleaned,
        summary: activeSummary,
        replyIntention,
        language: targetDraftLanguage,
      })
      setDraft(aiDraft)
    } catch {
      setDraft(generateDraft(activeCleaned, replyIntention, targetDraftLanguage))
    }
    setIsEditingDraft(false)
    setStatusText('')
  }

  async function handleRefineDraft() {
    console.log('[mail] Apply Changes clicked')
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
    const targetDraftLanguage = resolveDraftLanguage(draftLanguage, detectedEmailLanguage)
    try {
      const revised = await refineDraftAI({
        cleaned,
        currentDraft: draft,
        refinementInstruction: refineInput,
        language: targetDraftLanguage,
      })
      console.log('[mail] revised draft received')
      setDraft(revised)
      setIsEditingDraft(false)
      setRefineInput('')
      setStatusText('Draft updated.')
      console.log('[mail] draft state updated')
      window.setTimeout(() => setStatusText(''), 2500)
    } catch {
      const fallback = refineDraft(cleaned, draft, refineInput, targetDraftLanguage)
      setDraft(fallback)
      setIsEditingDraft(false)
      setRefineInput('')
      setStatusText('Draft updated.')
      console.log('[mail] draft state updated (fallback)')
      window.setTimeout(() => setStatusText(''), 2500)
    }
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
              {tr(summaryLanguage, 'latestSender')}: {summary?.latestSender || 'Unknown'} · {tr(summaryLanguage, 'replyingTo')}:{' '}
              {summary?.replyTo || 'Thread'} · {summary?.sectionCount || 0} {tr(summaryLanguage, 'messagesDetected')}
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
                  {summary?.labels.latestUpdate}
                </p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-zinc-300">
                  {summary?.latestUpdate.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
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
                  {summary?.changesProgression.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{summary?.labels.awaitingOpenItems}</p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-zinc-300">
                  {summary?.awaitingOpenItems.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{summary?.labels.suggestedReplyFocus}</p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-zinc-300">
                  {summary?.suggestedReplyFocus.map((item, idx) => <li key={idx}>• {item}</li>)}
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Your reply intention</p>
            {intentionVoiceStatus ? (
              <p className="text-[13px] font-medium text-cyan-300">{intentionVoiceStatus}</p>
            ) : null}
            {intentionVoiceError ? (
              <p className="text-[13px] text-rose-200/90">{intentionVoiceError}</p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={replyIntention}
                onChange={(e) => setReplyIntention(e.target.value)}
                rows={4}
                placeholder="Type what you want to say…"
                disabled={intentionVoiceBusy}
                className="w-full resize-none rounded-2xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-cyan-500/30 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={toggleIntentionVoice}
                disabled={intentionVoicePhase === 'transcribing'}
                className={`mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#0a0a0f] transition disabled:opacity-50 ${
                  intentionVoicePhase === 'recording'
                    ? 'animate-pulse bg-cyan-300'
                    : 'bg-gradient-to-br from-cyan-400 to-blue-600'
                }`}
                aria-label={intentionVoicePhase === 'recording' ? 'Stop recording' : 'Record reply intention'}
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
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Draft Reply</p>
              <select
                value={draftLanguage}
                onChange={(e) => handleDraftLanguageChange(e.target.value)}
                className="rounded-lg border border-white/15 bg-[#1a1a24] px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none"
              >
                {DRAFT_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-[12px] text-zinc-500">
              Draft language: {draftLanguage === 'auto' ? `Auto (${LANGUAGE_OPTIONS.find((x) => x.value === detectedEmailLanguage)?.label || 'English'})` : LANGUAGE_OPTIONS.find((x) => x.value === draftLanguage)?.label}
            </p>
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
