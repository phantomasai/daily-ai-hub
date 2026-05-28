import { transcribeOpenAI } from '../lib/transcribe.js'

export const config = {
  runtime: 'edge',
}

export default function handler(request) {
  return transcribeOpenAI(request)
}
