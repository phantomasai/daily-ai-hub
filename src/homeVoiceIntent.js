import { cleanApiKeyForHttp, getAiSettings } from './aiService.js'
import { MIXED_LANGUAGE_AI_RULE } from './aiPrompts.js'

/** @typedef {'tracker' | 'todo'} HomeVoiceDestination */

/**
 * @typedef {object} HomeVoiceIntent
 * @property {HomeVoiceDestination} destination
 * @property {string} text
 * @property {string} reason
 */

const TRACKER_SIGNAL =
  /\b(protein|whey|calories|kcal|macro|meal|food|eat|ate|drink|coffee|kawa|shake|egg|jajk|rice|paella|snack|breakfast|lunch|dinner|obiad|śniadanie|sniadanie|desayuno|walk|spacer|steps|workout|trening|training|gym|cardio|burn|lift|squat|deadlift|bench|pleców|plecow|back day|legs|arms|body\s*weight|waga|weight)\b/i

const TODO_SIGNAL =
  /\b(remind|przypomnij|task|todo|zadanie|errand|call|zadzwoń|zadzwon|phone|email|reply|odpowiedz|follow[- ]?up|supplier|registration|rejestracj|zapisz|dodaj|add|buy|kupić|kupic|schedule|meeting|spotkanie|update|project|monday|tuesday|wednesday|thursday|friday|saturday|sunday|poniedziałek|poniedzialek|wtorek|środa|sroda|czwartek|piątek|piatek|sobota|niedziela|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|tomorrow|jutro|mañana|manana)\b/i

/**
 * @param {string} text
 * @returns {HomeVoiceIntent}
 */
function classifyHeuristic(text) {
  const trimmed = text.trim()
  const trackerScore = (trimmed.match(TRACKER_SIGNAL) || []).length
  const todoScore = (trimmed.match(TODO_SIGNAL) || []).length

  if (trackerScore > todoScore && trackerScore > 0) {
    return {
      destination: 'tracker',
      text: trimmed,
      reason: 'Food, meal, drink, or workout cues detected.',
    }
  }
  if (todoScore > 0) {
    return {
      destination: 'todo',
      text: trimmed,
      reason: 'Task, reminder, or scheduling cues detected.',
    }
  }
  return {
    destination: 'todo',
    text: trimmed,
    reason: 'Ambiguous input; defaulting to To Do.',
  }
}

/**
 * @param {unknown} payload
 * @returns {HomeVoiceIntent | null}
 */
function parseAiIntent(payload, fallbackText) {
  const dest = payload?.destination
  if (dest !== 'tracker' && dest !== 'todo') return null
  const text = String(payload?.text || fallbackText).trim() || fallbackText.trim()
  const reason = String(payload?.reason || 'Classified by AI.').trim() || 'Classified by AI.'
  return { destination: dest, text, reason }
}

/**
 * Classify Home voice transcription for Tracker vs To Do routing.
 * @param {string} transcribedText
 * @returns {Promise<HomeVoiceIntent>}
 */
export async function classifyHomeVoiceIntent(transcribedText) {
  const trimmed = transcribedText.trim()
  if (!trimmed) {
    return { destination: 'todo', text: '', reason: 'Empty input; defaulting to To Do.' }
  }

  const fallback = classifyHeuristic(trimmed)
  const key = cleanApiKeyForHttp(getAiSettings().apiKey)
  if (!key) return fallback

  try {
    const res = await fetch('/api/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-openai-api-key': key,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You classify short voice commands for a personal productivity app.',
              MIXED_LANGUAGE_AI_RULE,
              'Return ONLY valid JSON: {"destination":"tracker"|"todo","text":"string","reason":"string"}',
              'destination "tracker": food, meals, drinks, calories, protein, workouts, walking, exercise, body metrics.',
              'destination "todo": reminders, tasks, errands, calls, follow-ups, registrations, things to do.',
              'If unclear, use "todo".',
              'text: normalized user intent in clear wording (same language mix is OK in text field; downstream will normalize).',
              'reason: one short English sentence.',
              'Examples: "whey protein z kawą" -> tracker; "dodaj call supplier tomorrow rano" -> todo; "trening pleców 70 minut" -> tracker; "zapisz rejestrację hulajnogi na wtorek" -> todo.',
            ].join(' '),
          },
          { role: 'user', content: trimmed },
        ],
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return fallback
    const content = data?.choices?.[0]?.message?.content
    if (!content) return fallback
    const parsed = JSON.parse(content)
    return parseAiIntent(parsed, trimmed) || fallback
  } catch {
    return fallback
  }
}

/** @typedef {'idle'|'understanding'|'routing_tracker'|'routing_todo'} HomeVoiceFlowPhase */

/**
 * @param {'idle'|'recording'|'transcribing'} voicePhase
 * @param {HomeVoiceFlowPhase} flowPhase
 */
export function getHomeVoiceStatusLabel(voicePhase, flowPhase) {
  if (flowPhase === 'understanding') return 'Understanding...'
  if (flowPhase === 'routing_tracker') return 'Routing to Tracker...'
  if (flowPhase === 'routing_todo') return 'Routing to To Do...'
  if (voicePhase === 'recording') return 'Recording...'
  if (voicePhase === 'transcribing') return 'Transcribing...'
  return ''
}
