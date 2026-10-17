import { transcribeOpenAI } from '../lib/transcribe.js'

// Node.js runtime (default). Prefer Node over Edge so long gpt-transcribe
// segment calls are not cut by Edge's short time-to-first-byte limit.
// maxDuration is set in vercel.json (Vite/non-Next projects).
//
// Use the Web Standard `fetch` export so Vercel Node passes a real Request
// (with formData/headers.get). A bare `export default function` is treated as
// the classic (req, res) Node handler and crashes multipart uploads with 500.

export default {
  fetch(request) {
    return transcribeOpenAI(request)
  },
}
