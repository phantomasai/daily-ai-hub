import { transcribeOpenAI } from '../lib/transcribe.js'

// Node.js runtime (default). Prefer Node over Edge so long gpt-transcribe
// segment calls are not cut by Edge's short time-to-first-byte limit.
// maxDuration is set in vercel.json (Vite/non-Next projects).

export default function handler(request) {
  return transcribeOpenAI(request)
}
