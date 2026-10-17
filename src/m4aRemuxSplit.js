/**
 * Split Apple Voice Memos / ISOBMFF M4A into independently playable M4A segments
 * via Mediabunny encoded-packet copy (no full-file PCM decode).
 *
 * Mediabunny APIs used (v1.61.x):
 * - Input + BlobSource + ALL_FORMATS / MP4
 * - Input.computeDuration()
 * - Output + Mp4OutputFormat({ fastStart: 'in-memory' }) + BufferTarget
 * - Conversion.init({ trim, copy: { mode: 'forced', boundaryPolicy: 'expand' } })
 * - Conversion.execute() → BufferTarget.buffer
 */

import { SAFE_UPLOAD_BYTES, estimateTranscribeMultipartBytes, MAX_MULTIPART_BODY_BYTES } from './audioLimits.js'

/** Preferred segment length for Voice Memos (~6 minutes). */
export const REMUX_TARGET_SEC = 6 * 60

/** Shortest remux window when size retries shrink the segment. */
export const REMUX_MIN_SEC = 90

/** Soft bitrate headroom when planning windows from file size / duration. */
const PLAN_SIZE_FACTOR = 0.88

/**
 * @param {File | Blob} file
 */
export function isM4aLikeFile(file) {
  const name = typeof file?.name === 'string' ? file.name.toLowerCase() : ''
  const type = String(file?.type || '').toLowerCase()
  if (name.endsWith('.m4a') || name.endsWith('.mp4')) return true
  return (
    type === 'audio/mp4' ||
    type === 'audio/x-m4a' ||
    type === 'audio/m4a' ||
    type === 'audio/aac' ||
    type === 'video/mp4'
  )
}

/**
 * Lazy-load Mediabunny only when M4A splitting is required.
 * @returns {Promise<typeof import('mediabunny')>}
 */
export async function loadMediabunny() {
  return import('mediabunny')
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @returns {{ blob: Blob, byteSize: number, multipartEstimate: number }}
 */
function finalizeSegmentBuffer(buffer, filename) {
  if (!buffer || !(buffer instanceof ArrayBuffer) || buffer.byteLength < 64) {
    throw new Error('Remux produced an empty or invalid M4A buffer.')
  }
  const blob = new Blob([buffer], { type: 'audio/mp4' })
  const multipartEstimate = estimateTranscribeMultipartBytes(blob, filename)
  return { blob, byteSize: blob.size, multipartEstimate }
}

/**
 * @param {object} mb
 * @param {import('mediabunny').Input} input
 * @param {number} startSec
 * @param {number} endSec
 * @param {string} filename
 */
async function remuxWindow(mb, input, startSec, endSec, filename) {
  const { Output, Conversion, Mp4OutputFormat, BufferTarget } = mb
  const target = new BufferTarget()
  const output = new Output({
    // Complete ISOBMFF (moov via fast-start), not fragmented fMP4 / raw AAC.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: { discard: true },
    trim: { start: startSec, end: endSec },
    copy: {
      mode: 'forced',
      boundaryPolicy: 'expand',
      shiftTolerance: Infinity,
    },
  })

  if (!conversion.isValid) {
    const reasons = (conversion.discardedTracks || [])
      .map((d) => `${d.track?.type || 'track'}:${d.reason}`)
      .join(', ')
    throw new Error(
      `Could not copy AAC into a playable M4A segment (${startSec.toFixed(1)}s–${endSec.toFixed(1)}s)${
        reasons ? `: ${reasons}` : '.'
      }`,
    )
  }

  const utilizedAudio = (conversion.utilizedTracks || []).some((t) => t.type === 'audio')
  if (!utilizedAudio) {
    throw new Error('Remux discarded the audio track — refusing to upload an empty segment.')
  }

  await conversion.execute()
  const buffer = target.buffer
  return finalizeSegmentBuffer(buffer, filename)
}

/**
 * Remux one time window; if the FINAL multipart estimate exceeds the limit,
 * retry with successively shorter windows from the same start.
 *
 * @param {object} mb
 * @param {import('mediabunny').Input} input
 * @param {number} startSec
 * @param {number} plannedEndSec
 * @param {number} fileEndSec
 * @param {number} index
 * @param {(info: object) => void} [onProgress]
 * @returns {Promise<{ chunk: object, consumedEndSec: number }>}
 */
async function remuxWindowWithSizeRetries(mb, input, startSec, plannedEndSec, fileEndSec, index, onProgress) {
  let windowEnd = Math.min(plannedEndSec, fileEndSec)
  let attempt = 0

  while (windowEnd - startSec >= REMUX_MIN_SEC - 0.01 || attempt === 0) {
    attempt += 1
    const endSec = Math.min(windowEnd, fileEndSec)
    if (endSec <= startSec + 0.05) {
      throw new Error('Remux window collapsed; cannot produce another segment.')
    }

    const filename = `part-${String(index + 1).padStart(3, '0')}.m4a`
    onProgress?.({
      phase: 'remuxing',
      current: index + 1,
      message: `Remuxing M4A segment ${index + 1} (${formatClock(startSec)}–${formatClock(endSec)})…`,
    })

    const { blob, byteSize, multipartEstimate } = await remuxWindow(mb, input, startSec, endSec, filename)

    if (byteSize <= SAFE_UPLOAD_BYTES && multipartEstimate <= MAX_MULTIPART_BODY_BYTES) {
      return {
        chunk: {
          index,
          blob,
          filename,
          startSec,
          endSec,
          byteSize,
          multipartEstimate,
        },
        consumedEndSec: endSec,
      }
    }

    // Too large for Vercel — shrink the time window and remux again.
    const span = endSec - startSec
    const nextSpan = Math.max(REMUX_MIN_SEC, span * 0.7)
    if (nextSpan >= span - 0.5) {
      throw new Error(
        `Segment ${index + 1} is still too large after remux (${formatBytes(byteSize)}, multipart ~${formatBytes(
          multipartEstimate,
        )}). Try exporting a lower-quality Voice Memo or a shorter clip.`,
      )
    }

    onProgress?.({
      phase: 'remux-resize',
      current: index + 1,
      message: `Segment ${index + 1} too large (${formatBytes(byteSize)}); retrying with a shorter window…`,
    })
    windowEnd = startSec + nextSpan
  }

  throw new Error(
    `Could not fit segment ${index + 1} under the upload limit even at ${REMUX_MIN_SEC}s windows.`,
  )
}

/**
 * @param {File} file
 * @param {{ onProgress?: (info: object) => void }} [options]
 * @returns {Promise<{ chunks: object[], durationSec: number, strategy: 'remuxed' }>}
 */
export async function splitM4aByRemux(file, options = {}) {
  const { onProgress } = options
  onProgress?.({ phase: 'remux-load', message: 'Loading M4A splitter…' })
  const mb = await loadMediabunny()
  const { Input, BlobSource, ALL_FORMATS, MP4 } = mb

  const input = new Input({
    source: new BlobSource(file),
    // Prefer MP4; ALL_FORMATS covers Voice Memo / QTFF edge cases.
    formats: ALL_FORMATS?.length ? ALL_FORMATS : [MP4],
  })

  try {
    onProgress?.({ phase: 'remux-probe', message: 'Reading Voice Memo duration…' })
    const durationSec = await input.computeDuration()
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error('Could not determine Voice Memo duration.')
    }

    const bytesPerSec = file.size / durationSec
    const bitrateCapSec = Math.max(
      REMUX_MIN_SEC,
      Math.floor((SAFE_UPLOAD_BYTES * PLAN_SIZE_FACTOR) / Math.max(bytesPerSec, 1)),
    )
    const plannedWindowSec = Math.min(REMUX_TARGET_SEC, bitrateCapSec)

    /** @type {object[]} */
    const chunks = []
    let cursor = 0
    let index = 0

    while (cursor < durationSec - 0.05) {
      const plannedEnd = Math.min(durationSec, cursor + plannedWindowSec)
      const { chunk, consumedEndSec } = await remuxWindowWithSizeRetries(
        mb,
        input,
        cursor,
        plannedEnd,
        durationSec,
        index,
        onProgress,
      )
      chunks.push(chunk)
      // Advance by the successful trim end. Mediabunny expand may slightly
      // overlap packet boundaries so speech at cuts is not dropped.
      cursor = consumedEndSec
      index += 1
      onProgress?.({
        phase: 'segmenting',
        current: chunks.length,
        message: `Prepared M4A segment ${chunks.length} (${formatBytes(chunk.byteSize)})`,
      })
      await new Promise((r) => setTimeout(r, 0))
    }

    if (!chunks.length) {
      throw new Error('M4A remux produced no segments.')
    }

    // Ensure last sample time is covered
    const last = chunks[chunks.length - 1]
    if (last.endSec < durationSec - 1.5) {
      throw new Error(
        `Remux coverage gap: last segment ends at ${formatClock(last.endSec)} but file is ${formatClock(durationSec)}.`,
      )
    }

    return { chunks, durationSec, strategy: 'remuxed' }
  } finally {
    try {
      input[Symbol.dispose]?.()
    } catch {
      /* ignore */
    }
  }
}

/** @param {number} sec */
function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** @param {number} n */
function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
