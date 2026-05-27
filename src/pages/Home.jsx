import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cleanApiKeyForHttp, getAiSettings } from '../aiService.js'
import { IconMic, IconSparkle } from '../components/Icons.jsx'
import { captureSpeechOnce, getVoiceStatusLabel, isSpeechRecognitionSupported } from '../trackerVoice.js'

/** Heartbeat / activity line — dark glyph on cyan/blue badge */
function HomeIconPulse({ className = 'h-[22px] w-[22px]' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12h2.5l2-6 3.5 12L14.5 7 17 12h4" />
    </svg>
  )
}

/** Checklist with lines */
function HomeIconChecklist({ className = 'h-[22px] w-[22px]' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6h11M9 12h11M9 18h8" />
      <path d="m4.5 6 1.5 1.5L8.5 5" />
      <path d="m4.5 12 1.5 1.5L8.5 11" />
      <circle cx="5" cy="18" r="1.5" />
    </svg>
  )
}

/** Envelope */
function HomeIconMail({ className = 'h-[22px] w-[22px]' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 5.5L20 7" />
    </svg>
  )
}

/** Open book / journal (two pages + spine) */
function HomeIconJournal({ className = 'h-[22px] w-[22px]' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v18H5.5A2.5 2.5 0 0 1 3 18.5v-13Z" />
      <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H12v18h6.5a2.5 2.5 0 0 0 2.5-2.5v-13Z" />
      <path d="M12 3v18" />
      <path d="M7 8h2M15 8h2M7 12h2.5M15 12h2.5" />
    </svg>
  )
}

function GradientIconBadge({ children }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 via-cyan-300 to-blue-600 text-[#0a0a0f] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
      {children}
    </div>
  )
}

function HomeCard({ to, title, subtitle, icon }) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#12121a] p-4 transition hover:border-cyan-500/25 hover:bg-[#16161f]"
    >
      <GradientIconBadge>{icon}</GradientIconBadge>
      <div>
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-zinc-500">{subtitle}</p>
      </div>
    </Link>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [voicePhase, setVoicePhase] = useState('idle')
  const [voiceError, setVoiceError] = useState('')
  const hasApiKey = cleanApiKeyForHttp(getAiSettings().apiKey).length > 0
  const voiceBusy = voicePhase !== 'idle'
  const statusLabel = getVoiceStatusLabel(voicePhase, false)

  async function handleHomeVoice() {
    if (voiceBusy) return
    setVoiceError('')
    if (!isSpeechRecognitionSupported()) {
      setVoiceError('Voice dictation is not supported in this browser. Try Chrome or Safari on mobile.')
      return
    }
    if (!hasApiKey) {
      setVoiceError('Please add your API key in Settings')
      return
    }
    try {
      const said = await captureSpeechOnce({ onPhase: setVoicePhase })
      navigate('/tracker', { state: { analyzeText: said } })
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Could not capture voice.')
      setVoicePhase('idle')
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Daily AI Hub</p>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white sm:text-[30px]">
          Hello.{' '}
          <span className="bg-gradient-to-r from-cyan-400 via-cyan-300 to-blue-500 bg-clip-text text-transparent">
            What&apos;s on your mind?
          </span>
        </h1>
      </header>

      <section className="rounded-[24px] border border-white/10 bg-[#12121a] px-6 py-10 text-center shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
        <button
          type="button"
          onClick={handleHomeVoice}
          disabled={voiceBusy}
          className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full text-[#0a0a0f] shadow-[0_12px_40px_rgba(56,189,248,0.35)] transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 ${
            voicePhase === 'listening'
              ? 'animate-pulse bg-cyan-300'
              : 'bg-gradient-to-br from-cyan-400 to-blue-600'
          }`}
          aria-label="Voice input for Daily Tracker"
        >
          <IconMic className="h-11 w-11" />
        </button>
        {statusLabel ? (
          <p className="mx-auto mt-4 text-[14px] font-medium text-cyan-300">{statusLabel}</p>
        ) : null}
        {voiceError ? (
          <p className="mx-auto mt-4 max-w-[280px] text-[13px] leading-snug text-amber-200/90">
            {voiceError}
            {voiceError.includes('API key') ? (
              <>
                {' '}
                <Link to="/settings" className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
                  Settings
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="mx-auto mt-5 max-w-[260px] text-[14px] text-zinc-500">
          Tap to dictate food or workouts — logged via Daily Tracker
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <HomeCard
          to="/tracker"
          title="Daily Tracker"
          subtitle="Food, workouts & body"
          icon={<HomeIconPulse />}
        />
        <HomeCard
          to="/todo"
          title="To Do"
          subtitle="Voice-first tasks"
          icon={<HomeIconChecklist />}
        />
        <HomeCard
          to="/mail"
          title="Mail Assistant"
          subtitle="Clean threads, draft replies"
          icon={<HomeIconMail />}
        />
        <HomeCard
          to="/history"
          title="Journal"
          subtitle="Your daily history"
          icon={<HomeIconJournal />}
        />
      </div>

      <button
        type="button"
        disabled
        className="flex w-full items-center gap-4 rounded-[24px] border border-white/5 bg-[#12121a]/80 px-4 py-4 text-left opacity-60"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/40 bg-transparent text-cyan-300/80">
          <IconSparkle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-zinc-400">Future tools</p>
          <p className="mt-0.5 truncate text-[13px] text-zinc-600">
            Calendar, Todoist, Gmail, Outlook, n8n…
          </p>
        </div>
      </button>
    </div>
  )
}
