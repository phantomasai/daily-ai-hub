import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { proxyOpenAiChat } from './lib/openai.js'
import { transcribeOpenAI } from './lib/transcribe.js'

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function transcribeDevApiPlugin() {
  return {
    name: 'transcribe-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/api/transcribe') return next()

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const env = loadEnv(server.config.mode, process.cwd(), '')
        const prevKey = process.env.OPENAI_API_KEY
        if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY

        try {
          const body = await readRequestBody(req)
          const host = req.headers.host || 'localhost:5173'
          const webReq = new Request(`http://${host}/api/transcribe`, {
            method: 'POST',
            headers: req.headers,
            body,
          })
          const response = await transcribeOpenAI(webReq)
          res.statusCode = response.status
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'content-length') return
            res.setHeader(key, value)
          })
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          console.error('[transcribe] dev middleware error', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Transcription failed.' }))
        } finally {
          if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey
          else delete process.env.OPENAI_API_KEY
        }
      })
    },
  }
}

function openAiDevApiPlugin() {
  return {
    name: 'openai-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/api/openai') return next()

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const env = loadEnv(server.config.mode, process.cwd(), '')
        const prevKey = process.env.OPENAI_API_KEY
        if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY

        try {
          const body = await readRequestBody(req)
          const host = req.headers.host || 'localhost:5173'
          const webReq = new Request(`http://${host}/api/openai`, {
            method: 'POST',
            headers: req.headers,
            body,
          })
          const response = await proxyOpenAiChat(webReq)
          res.statusCode = response.status
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'content-length') return
            res.setHeader(key, value)
          })
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          console.error('[openai] dev middleware error', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'OpenAI request failed.' }))
        } finally {
          if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey
          else delete process.env.OPENAI_API_KEY
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), transcribeDevApiPlugin(), openAiDevApiPlugin()],
  server: {
    proxy: {
      // Same paths as vercel.json rewrites — keep browser on same origin for OpenAI / Anthropic.
      '/__ai/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__ai\/openai/, ''),
      },
      '/__ai/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__ai\/anthropic/, ''),
      },
    },
  },
})
