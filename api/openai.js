import { proxyOpenAiChat } from '../lib/openai.js'

export const config = {
  runtime: 'edge',
}

export default function handler(request) {
  return proxyOpenAiChat(request)
}
