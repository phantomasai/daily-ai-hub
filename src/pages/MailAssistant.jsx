import { useState } from 'react'

const placeholderSummary =
  'Placeholder: the thread is about rescheduling a design review. The sender asks for two alternative slots next week and wants async comments on v2 mocks.'

const placeholderReply = `Hi Alex — thanks for the heads-up. Tuesday 3–4pm or Thursday 10–11am work on my side. I'll drop notes on the v2 mocks by EOD tomorrow.

Best,
[You]`

export default function MailAssistant() {
  const [thread, setThread] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  function handleClean() {
    if (!thread.trim()) return
    setShowPreview(true)
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Mail</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Mail Assistant</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
          Paste your thread. I&apos;ll clean, summarize and draft. You copy and send.
        </p>
      </header>

      <section className="space-y-4 rounded-[24px] border border-white/10 bg-[#12121a] p-5">
        <textarea
          value={thread}
          onChange={(e) => setThread(e.target.value)}
          rows={10}
          placeholder="Paste full email thread here…"
          className="w-full resize-none rounded-2xl border border-white/10 bg-[#1a1a24] px-4 py-3 text-[14px] leading-relaxed text-white outline-none placeholder:text-zinc-600 focus:border-cyan-500/30"
        />
        <button
          type="button"
          onClick={handleClean}
          className="w-full rounded-full bg-gradient-to-r from-[#7b91ff] to-[#29d8ff] py-3.5 text-[15px] font-semibold text-[#0a0a0f] shadow-[0_12px_32px_rgba(41,216,255,0.25)] transition hover:brightness-105 active:brightness-95"
        >
          Clean Thread
        </button>
      </section>

      {showPreview ? (
        <div className="space-y-4">
          <section className="rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Summary</p>
            <p className="mt-3 text-[14px] leading-relaxed text-zinc-200">{placeholderSummary}</p>
          </section>
          <section className="rounded-[24px] border border-white/10 bg-[#12121a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Draft reply</p>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-zinc-200">
              {placeholderReply}
            </pre>
            <p className="mt-4 text-[12px] text-zinc-600">
              Static preview for UI — model output will replace this once API keys are connected.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  )
}
