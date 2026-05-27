import { getAiSettings } from './aiService.js'

export function isSpeechRecognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition
}

function getSpeechLocale() {
  return getAiSettings().language === 'pl' ? 'pl-PL' : 'en-US'
}

/** @typedef {'idle' | 'listening' | 'transcribing'} VoicePhase */

/**
 * One-shot browser speech capture. Resolves with trimmed transcript text.
 * @param {{ onPhase?: (phase: VoicePhase) => void }} [options]
 * @returns {Promise<string>}
 */
export function captureSpeechOnce({ onPhase } = {}) {
  const SR = getSpeechRecognitionCtor()
  if (!SR) {
    return Promise.reject(
      new Error('Voice dictation is not supported in this browser. Try Chrome or Safari on mobile.'),
    )
  }

  return new Promise((resolve, reject) => {
    const rec = new SR()
    rec.lang = getSpeechLocale()
    rec.interimResults = false
    rec.maxAlternatives = 1

    let settled = false
    const done = (fn) => {
      if (settled) return
      settled = true
      onPhase?.('idle')
      fn()
    }

    rec.onstart = () => onPhase?.('listening')

    rec.onresult = (ev) => {
      onPhase?.('transcribing')
      const said = ev.results[0]?.[0]?.transcript?.trim()
      if (said) done(() => resolve(said))
      else done(() => reject(new Error('No speech detected. Try again.')))
    }

    rec.onerror = (ev) => {
      const code = ev.error
      const msg =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone permission denied. Allow mic access in your browser settings.'
          : code === 'no-speech'
            ? 'No speech detected. Try again.'
            : code === 'aborted'
              ? 'Voice capture cancelled.'
              : 'Could not capture voice. Try again.'
      done(() => reject(new Error(msg)))
    }

    rec.onend = () => {
      if (!settled) {
        done(() => reject(new Error('No speech detected. Try again.')))
      }
    }

    try {
      rec.start()
    } catch {
      done(() => reject(new Error('Could not start microphone.')))
    }
  })
}

/**
 * @param {VoicePhase} voicePhase
 * @param {boolean} analyzing
 */
export function getVoiceStatusLabel(voicePhase, analyzing) {
  if (analyzing) return 'Analyzing food…'
  if (voicePhase === 'listening') return 'Listening…'
  if (voicePhase === 'transcribing') return 'Transcribing…'
  return ''
}
