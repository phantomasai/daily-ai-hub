/** Vercel Edge Functions documented request body limit (~4 MB). */
export const VERCEL_EDGE_BODY_LIMIT = 4 * 1024 * 1024

/**
 * Soft target for the audio blob alone (leaves room for multipart fields).
 * Kept under the Edge 4 MB body limit.
 */
export const SAFE_UPLOAD_BYTES = Math.floor(3.2 * 1024 * 1024)

/**
 * Hard cap for estimated multipart/form-data body (file + language + prompt).
 * Must stay below Vercel Edge ~4 MB.
 */
export const MAX_MULTIPART_BODY_BYTES = Math.floor(3.6 * 1024 * 1024)

/**
 * WAV/PCM fallback is only allowed for short media (never 30–60 min meetings).
 */
export const WAV_FALLBACK_MAX_DURATION_SEC = 3 * 60

/**
 * Estimate multipart/form-data size for /api/transcribe uploads.
 * Includes boundary/headers overhead for file + language + prompt fields.
 *
 * @param {Blob} blob
 * @param {string} [filename]
 * @param {{ language?: string, prompt?: string }} [fields]
 */
export function estimateTranscribeMultipartBytes(blob, filename = 'audio.m4a', fields = {}) {
  const language = fields.language || 'auto'
  const prompt =
    fields.prompt ||
    'The audio may mix English, Spanish, and Polish. Transcribe in the original languages. Do not translate.'
  const boundary = 70 // typical multipart boundary length + dashes
  const partOverhead = (name, valueLen) => 120 + name.length + valueLen + boundary

  const fileHeaders = 180 + String(filename).length + String(blob.type || 'audio/mp4').length
  const filePart = fileHeaders + blob.size + boundary
  const languagePart = partOverhead('language', language.length)
  const promptPart = partOverhead('prompt', prompt.length)

  return filePart + languagePart + promptPart + boundary + 8
}

/**
 * @param {Blob} blob
 * @param {string} [filename]
 * @returns {{ ok: boolean, blobSize: number, multipartEstimate: number }}
 */
export function checkUploadSize(blob, filename) {
  const multipartEstimate = estimateTranscribeMultipartBytes(blob, filename)
  return {
    ok: blob.size <= SAFE_UPLOAD_BYTES && multipartEstimate <= MAX_MULTIPART_BODY_BYTES,
    blobSize: blob.size,
    multipartEstimate,
  }
}
