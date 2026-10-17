/**
 * Audio preparation for Vercel-safe transcription uploads.
 *
 * Strategy:
 * - Files ≤ SAFE_UPLOAD_BYTES: upload original as a single part.
 * - Large Apple Voice Memos / M4A: Mediabunny AAC copy-remux into ~6 min
 *   independently playable .m4a segments (lazy-loaded). Never full-file PCM.
 * - Other oversized formats: short WAV/PCM fallback only (≤ 3 minutes).
 * - Long M4A remux failures: clear error (no silent PCM decode of meetings).
 */

import {
  SAFE_UPLOAD_BYTES,
  WAV_FALLBACK_MAX_DURATION_SEC,
  checkUploadSize,
  estimateTranscribeMultipartBytes,
  MAX_MULTIPART_BODY_BYTES,
} from './audioLimits.js'
import { isM4aLikeFile, splitM4aByRemux } from './m4aRemuxSplit.js'

export {
  SAFE_UPLOAD_BYTES,
  WAV_FALLBACK_MAX_DURATION_SEC,
  MAX_MULTIPART_BODY_BYTES,
  estimateTranscribeMultipartBytes,
  checkUploadSize,
} from './audioLimits.js'

/** Target PCM rate for short WAV fallback chunks. */
export const TARGET_SAMPLE_RATE = 16000

/** Seconds of 16-bit mono PCM per short WAV fallback chunk. */
export const CHUNK_DURATION_SEC = 85

const ACCEPTED_EXT = /\.(m4a|mp3|wav|mp4|webm)$/i

export class AudioDecodeError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, code?: string }} [opts]
   */
  constructor(message, opts = {}) {
    super(message)
    this.name = 'AudioDecodeError'
    this.code = opts.code || 'DECODE_UNSUPPORTED'
    if (opts.cause !== undefined) this.cause = opts.cause
  }
}

/**
 * @param {File | Blob} file
 */
export function isAcceptedAudioFile(file) {
  const name = typeof file?.name === 'string' ? file.name : ''
  const type = String(file?.type || '').toLowerCase()
  if (ACCEPTED_EXT.test(name)) return true
  return (
    type.includes('audio/') ||
    type === 'video/mp4' ||
    type === 'video/webm' ||
    type === 'audio/mp4' ||
    type === 'audio/x-m4a' ||
    type === 'audio/m4a'
  )
}

/**
 * @param {File | Blob} file
 */
export function guessAudioFilename(file) {
  if (typeof file?.name === 'string' && file.name.trim()) return file.name.trim()
  const type = String(file?.type || '').toLowerCase()
  if (type.includes('mpeg') || type.includes('mp3')) return 'audio.mp3'
  if (type.includes('wav')) return 'audio.wav'
  if (type.includes('webm')) return 'audio.webm'
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'audio.m4a'
  return 'audio.wav'
}

/**
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Blob}
 */
export function encodeWavMono16(samples, sampleRate) {
  const numSamples = samples.length
  const dataSize = numSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * @param {AudioBuffer} audioBuffer
 * @param {number} targetRate
 * @returns {Float32Array}
 */
function downmixResampleMono(audioBuffer, targetRate) {
  const channels = audioBuffer.numberOfChannels
  const srcRate = audioBuffer.sampleRate
  const srcLength = audioBuffer.length
  const ratio = srcRate / targetRate
  const outLength = Math.max(1, Math.floor(srcLength / ratio))
  const out = new Float32Array(outLength)

  /** @type {Float32Array[]} */
  const chans = []
  for (let c = 0; c < channels; c++) chans.push(audioBuffer.getChannelData(c))

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(srcLength - 1, i0 + 1)
    const frac = srcPos - i0
    let sample = 0
    for (let c = 0; c < channels; c++) {
      const a = chans[c][i0] || 0
      const b = chans[c][i1] || 0
      sample += a + (b - a) * frac
    }
    out[i] = sample / channels
  }

  return out
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioArrayBuffer(arrayBuffer) {
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
    throw new AudioDecodeError(
      'This browser cannot decode audio in-page (Web Audio API missing). Export as WAV/MP3 or use Safari/Chrome.',
    )
  }

  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  try {
    const copy = arrayBuffer.slice(0)
    return await ctx.decodeAudioData(copy)
  } catch (err) {
    throw new AudioDecodeError('Could not decode this audio in the browser for WAV fallback.', {
      cause: err,
    })
  } finally {
    try {
      await ctx.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * @typedef {object} AudioChunkPart
 * @property {number} index
 * @property {Blob} blob
 * @property {string} filename
 * @property {number} startSec
 * @property {number} endSec
 * @property {number} byteSize
 * @property {number} [multipartEstimate]
 */

/**
 * @typedef {object} PreparedAudio
 * @property {AudioChunkPart[]} chunks
 * @property {'direct' | 'remuxed' | 'segmented'} strategy
 * @property {number | null} durationSec
 * @property {string} sourceName
 */

/**
 * Short WAV/PCM fallback — never used for long Voice Memos.
 * @param {File} file
 * @param {{ onProgress?: Function }} options
 * @returns {Promise<PreparedAudio>}
 */
async function prepareShortWavFallback(file, options = {}) {
  const { onProgress } = options
  const sourceName = guessAudioFilename(file)

  onProgress?.({ phase: 'decoding', message: 'Decoding short audio for WAV fallback…' })
  const arrayBuffer = await file.arrayBuffer()
  const audioBuffer = await decodeAudioArrayBuffer(arrayBuffer)
  const durationSec = audioBuffer.duration

  if (durationSec > WAV_FALLBACK_MAX_DURATION_SEC) {
    throw new AudioDecodeError(
      `WAV fallback is limited to ${WAV_FALLBACK_MAX_DURATION_SEC / 60} minutes. This file is ~${Math.round(
        durationSec / 60,
      )} minutes. For long Apple Voice Memos, M4A remux is required.`,
      { code: 'WAV_FALLBACK_TOO_LONG' },
    )
  }

  onProgress?.({
    phase: 'resampling',
    message: `Resampling ${Math.round(durationSec)}s to ${TARGET_SAMPLE_RATE} Hz mono…`,
  })
  const mono = downmixResampleMono(audioBuffer, TARGET_SAMPLE_RATE)
  const samplesPerChunk = TARGET_SAMPLE_RATE * CHUNK_DURATION_SEC
  const totalChunks = Math.max(1, Math.ceil(mono.length / samplesPerChunk))
  /** @type {AudioChunkPart[]} */
  const chunks = []

  for (let i = 0; i < totalChunks; i++) {
    const startSample = i * samplesPerChunk
    const endSample = Math.min(mono.length, startSample + samplesPerChunk)
    const slice = mono.subarray(startSample, endSample)
    const wav = encodeWavMono16(slice, TARGET_SAMPLE_RATE)
    const filename = `part-${String(i + 1).padStart(3, '0')}.wav`
    const sizeCheck = checkUploadSize(wav, filename)
    if (!sizeCheck.ok) {
      throw new Error(
        `WAV segment ${i + 1} exceeds upload limits (${Math.round(wav.size / 1024)} KB blob, multipart ~${Math.round(
          sizeCheck.multipartEstimate / 1024,
        )} KB).`,
      )
    }
    chunks.push({
      index: i,
      blob: wav,
      filename,
      startSec: startSample / TARGET_SAMPLE_RATE,
      endSec: endSample / TARGET_SAMPLE_RATE,
      byteSize: wav.size,
      multipartEstimate: sizeCheck.multipartEstimate,
    })
    onProgress?.({
      phase: 'segmenting',
      current: i + 1,
      total: totalChunks,
      message: `Encoded WAV segment ${i + 1} of ${totalChunks}`,
    })
    await new Promise((r) => setTimeout(r, 0))
  }

  return { chunks, strategy: 'segmented', durationSec, sourceName }
}

/**
 * Prepare upload-safe audio parts. Never byte-slices compressed containers.
 *
 * @param {File} file
 * @param {{ onProgress?: (info: { phase: string, current?: number, total?: number, message?: string }) => void }} [options]
 * @returns {Promise<PreparedAudio>}
 */
export async function prepareAudioChunks(file, options = {}) {
  const { onProgress } = options
  const sourceName = guessAudioFilename(file)

  if (!file?.size) {
    throw new Error('No audio data in the selected file.')
  }

  if (!isAcceptedAudioFile(file)) {
    throw new Error('Unsupported file type. Use .m4a, .mp3, .wav, .mp4, or .webm.')
  }

  // Small enough for a single Vercel request — keep original bytes.
  if (file.size <= SAFE_UPLOAD_BYTES) {
    const sizeCheck = checkUploadSize(file, sourceName)
    if (sizeCheck.ok) {
      onProgress?.({ phase: 'ready', message: 'File is within upload limit — sending as a single part.' })
      return {
        chunks: [
          {
            index: 0,
            blob: file,
            filename: sourceName,
            startSec: 0,
            endSec: 0,
            byteSize: file.size,
            multipartEstimate: sizeCheck.multipartEstimate,
          },
        ],
        strategy: 'direct',
        durationSec: null,
        sourceName,
      }
    }
    // Blob alone looked small enough historically, but multipart estimate exceeds
    // the hard cap — fall through to split paths.
  }

  // Large Voice Memo / M4A: AAC remux only (never full-meeting PCM).
  if (isM4aLikeFile(file)) {
    try {
      const remuxed = await splitM4aByRemux(file, { onProgress })
      return {
        chunks: remuxed.chunks,
        strategy: 'remuxed',
        durationSec: remuxed.durationSec,
        sourceName,
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new AudioDecodeError(
        [
          'Could not split this Apple Voice Memo with lossless M4A remux.',
          detail,
          'The app will not decode a full 30–60 minute recording into PCM on iPhone.',
          'Try again on Safari, re-export the memo, or split it in Voice Memos first.',
        ].join(' '),
        { cause: err, code: 'M4A_REMUX_FAILED' },
      )
    }
  }

  // Non-M4A oversized files: short WAV fallback only.
  return prepareShortWavFallback(file, options)
}
