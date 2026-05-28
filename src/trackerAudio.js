import { cleanApiKeyForHttp, getAiSettings } from './aiService.js'

/** @typedef {'idle' | 'recording' | 'transcribing'} VoicePhase */

export function isAudioRecordingSupported() {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  )
}

/**
 * @param {VoicePhase} voicePhase
 * @param {boolean} analyzing
 */
export function getVoiceStatusLabel(voicePhase, analyzing) {
  if (analyzing) return 'Analyzing food…'
  if (voicePhase === 'recording') return 'Recording...'
  if (voicePhase === 'transcribing') return 'Transcribing...'
  return ''
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

function blobFilename(mimeType) {
  if (mimeType.includes('mp4')) return 'recording.m4a'
  if (mimeType.includes('ogg')) return 'recording.ogg'
  return 'recording.webm'
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function transcribeAudioBlob(blob) {
  if (!blob?.size) {
    throw new Error('Recording failed — no audio captured.')
  }

  const form = new FormData()
  const mime = blob.type || 'audio/webm'
  form.append('file', blob, blobFilename(mime))
  // Let OpenAI auto-detect language for bilingual speech (PL/EN).
  form.append('language', 'auto')

  console.log('[voice] audio blob size:', blob.size)
  console.log('[voice] audio sent to /api/transcribe')
  const apiKey = cleanApiKeyForHttp(getAiSettings().apiKey)
  const headers = apiKey ? { 'x-openai-api-key': apiKey } : undefined
  const res = await fetch('/api/transcribe', { method: 'POST', body: form, headers })
  let data = {}
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Transcription failed.')
  }

  const text = typeof data.text === 'string' ? data.text.trim() : ''
  if (!text) {
    throw new Error('Empty transcription. Try speaking again.')
  }

  console.log('[voice] transcription received:', text)
  return text
}

/**
 * Tap-to-start / tap-to-stop recorder.
 * @param {{ onPhase?: (phase: VoicePhase) => void }} [options]
 */
export function createVoiceRecorder({ onPhase } = {}) {
  /** @type {VoicePhase} */
  let phase = 'idle'
  /** @type {MediaRecorder | null} */
  let mediaRecorder = null
  /** @type {MediaStream | null} */
  let stream = null
  /** @type {Blob[]} */
  let chunks = []
  /** @type {string} */
  let mimeType = 'audio/webm'

  const setPhase = (next) => {
    phase = next
    onPhase?.(next)
  }

  const stopStream = () => {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  return {
    getPhase: () => phase,

    async start() {
      if (phase !== 'idle') return

      if (!isAudioRecordingSupported()) {
        throw new Error('Audio recording is not supported in this browser.')
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        const name = err && typeof err === 'object' && 'name' in err ? err.name : ''
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error('Microphone permission denied. Allow mic access in your browser settings.')
        }
        throw new Error('Could not access microphone.')
      }

      mimeType = pickMimeType() || 'audio/webm'
      chunks = []

      try {
        mediaRecorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream)
      } catch {
        mediaRecorder = new MediaRecorder(stream)
        mimeType = mediaRecorder.mimeType || 'audio/webm'
      }

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data?.size > 0) chunks.push(ev.data)
      }

      mediaRecorder.onerror = () => {
        stopStream()
        mediaRecorder = null
        chunks = []
        setPhase('idle')
      }

      mediaRecorder.start()
      setPhase('recording')
      console.log('[voice] recording started')
    },

    stopAndTranscribe() {
      if (phase !== 'recording' || !mediaRecorder) {
        return Promise.reject(new Error('Not recording.'))
      }

      console.log('[voice] recording stopped')

      return new Promise((resolve, reject) => {
        const recorder = mediaRecorder

        recorder.onstop = async () => {
          stopStream()
          mediaRecorder = null
          const type = recorder.mimeType || mimeType || 'audio/webm'
          const blob = new Blob(chunks, { type })
          chunks = []

          if (!blob.size) {
            setPhase('idle')
            reject(new Error('Recording failed — no audio captured.'))
            return
          }

          setPhase('transcribing')
          try {
            const text = await transcribeAudioBlob(blob)
            setPhase('idle')
            resolve(text)
          } catch (err) {
            setPhase('idle')
            reject(err instanceof Error ? err : new Error('Transcription failed.'))
          }
        }

        try {
          recorder.stop()
        } catch {
          stopStream()
          mediaRecorder = null
          chunks = []
          setPhase('idle')
          reject(new Error('Recording failed.'))
        }
      })
    },

    cancel() {
      if (mediaRecorder && phase === 'recording') {
        try {
          mediaRecorder.stop()
        } catch {
          /* ignore */
        }
      }
      stopStream()
      mediaRecorder = null
      chunks = []
      setPhase('idle')
    },
  }
}
