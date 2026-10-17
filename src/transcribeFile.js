import { cleanApiKeyForHttp, getAiSettings } from './aiService.js'
import { AudioDecodeError, prepareAudioChunks } from './audioSegment.js'

const MIXED_LANG_PROMPT =
  'The audio may mix English, Spanish, and Polish. Transcribe in the original languages. Do not translate.'

const MAX_RETRIES = 3
const RETRY_BASE_MS = 900

/**
 * @param {Blob} blob
 * @param {{ language?: string, filename?: string, prompt?: string }} [options]
 * @returns {Promise<string>}
 */
export async function transcribeUploadBlob(blob, options = {}) {
  if (!blob?.size) {
    throw new Error('No audio to transcribe.')
  }

  const language = options.language && options.language !== 'auto' ? options.language : 'auto'
  const filename = options.filename || 'audio.wav'
  const prompt = options.prompt ?? MIXED_LANG_PROMPT

  const form = new FormData()
  form.append('file', blob, filename)
  form.append('language', language)
  if (prompt) form.append('prompt', prompt)

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
    throw new Error(typeof data.error === 'string' ? data.error : `Transcription failed (${res.status}).`)
  }

  const text = typeof data.text === 'string' ? data.text.trim() : ''
  if (!text) {
    throw new Error('Empty transcription for this segment.')
  }
  return text
}

/**
 * @param {() => Promise<string>} fn
 * @param {{ retries?: number, onRetry?: (attempt: number, err: Error) => void }} [opts]
 */
async function withRetries(fn, opts = {}) {
  const retries = opts.retries ?? MAX_RETRIES
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt >= retries) break
      opts.onRetry?.(attempt + 1, lastErr)
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)))
    }
  }
  throw lastErr
}

/**
 * @typedef {object} ChunkTranscriptResult
 * @property {number} index
 * @property {number} startSec
 * @property {number} endSec
 * @property {'ok' | 'failed'} status
 * @property {string} text
 * @property {string} [error]
 */

/**
 * @typedef {object} FileTranscriptionResult
 * @property {string} transcript
 * @property {ChunkTranscriptResult[]} parts
 * @property {boolean} partial
 * @property {'direct' | 'remuxed' | 'segmented'} strategy
 * @property {number | null} durationSec
 * @property {string[]} errors
 */

/**
 * Decode/segment as needed, transcribe in order with retries. Never silently drops a chunk.
 *
 * @param {File} file
 * @param {{
 *   language?: string,
 *   signal?: AbortSignal,
 *   onProgress?: (info: Record<string, unknown>) => void,
 * }} [options]
 * @returns {Promise<FileTranscriptionResult>}
 */
export async function transcribeAudioFile(file, options = {}) {
  const language = options.language || 'auto'
  const onProgress = options.onProgress

  let prepared
  try {
    prepared = await prepareAudioChunks(file, {
      onProgress: (info) => onProgress?.({ stage: 'prepare', ...info }),
    })
  } catch (err) {
    if (err instanceof AudioDecodeError) throw err
    throw err
  }

  const { chunks, strategy, durationSec } = prepared
  /** @type {ChunkTranscriptResult[]} */
  const parts = chunks.map((c) => ({
    index: c.index,
    startSec: c.startSec,
    endSec: c.endSec,
    status: /** @type {'failed'} */ ('failed'),
    text: '',
    error: 'Not started',
  }))

  for (let i = 0; i < chunks.length; i++) {
    if (options.signal?.aborted) {
      throw new Error('Transcription cancelled.')
    }

    const chunk = chunks[i]
    onProgress?.({
      stage: 'transcribe',
      current: i + 1,
      total: chunks.length,
      message: `Transcribing segment ${i + 1} of ${chunks.length}…`,
    })

    try {
      const text = await withRetries(
        () =>
          transcribeUploadBlob(chunk.blob, {
            language,
            filename: chunk.filename,
          }),
        {
          onRetry: (attempt, err) => {
            onProgress?.({
              stage: 'retry',
              current: i + 1,
              total: chunks.length,
              message: `Retry ${attempt} for segment ${i + 1}: ${err.message}`,
            })
          },
        },
      )
      parts[i] = {
        index: chunk.index,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        status: 'ok',
        text,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transcription failed.'
      parts[i] = {
        index: chunk.index,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        status: 'failed',
        text: '',
        error: message,
      }
    }
  }

  const errors = parts.filter((p) => p.status === 'failed').map((p) => `Segment ${p.index + 1}: ${p.error}`)
  const partial = errors.length > 0
  const transcript = combineOrderedParts(parts)

  onProgress?.({
    stage: 'done',
    current: chunks.length,
    total: chunks.length,
    message: partial ? 'Finished with some failed segments.' : 'Transcription complete.',
  })

  return {
    transcript,
    parts,
    partial,
    strategy,
    durationSec,
    errors,
  }
}

/**
 * Ordered combine — failed segments become explicit markers (never omitted).
 * @param {ChunkTranscriptResult[]} parts
 */
export function combineOrderedParts(parts) {
  const ordered = [...parts].sort((a, b) => a.index - b.index)
  const blocks = ordered.map((p) => {
    if (p.status === 'ok' && p.text.trim()) return p.text.trim()
    const label =
      p.endSec > p.startSec
        ? `[Segment ${p.index + 1} failed (${formatClock(p.startSec)}–${formatClock(p.endSec)}): ${p.error || 'error'}]`
        : `[Segment ${p.index + 1} failed: ${p.error || 'error'}]`
    return label
  })
  return blocks.join('\n\n').trim()
}

/** @param {number} sec */
function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export { AudioDecodeError }
