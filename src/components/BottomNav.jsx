import { NavLink } from 'react-router-dom'
import {
  IconHistory,
  IconHome,
  IconMail,
  IconPulse,
  IconSettings,
  IconTodo,
} from './Icons.jsx'

const items = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/tracker', label: 'Tracker', Icon: IconPulse },
  { to: '/todo', label: 'To Do', Icon: IconTodo },
  { to: '/mail', label: 'Mail', Icon: IconMail },
  { to: '/history', label: 'History', Icon: IconHistory },
  { to: '/settings', label: 'Settings', Icon: IconSettings },
]

export default function BottomNav() {
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
      aria-label="Primary"
    >
      <div className="pointer-events-auto flex w-full max-w-[404px] items-stretch justify-between gap-0.5 rounded-[28px] border border-white/10 bg-[#12121a]/95 px-1 py-2 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-1 text-[10px] font-medium transition-colors',
                isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative flex h-7 items-center justify-center">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="relative truncate tracking-tight">{label}</span>
                {isActive ? (
                  <span className="mx-auto -mt-0.5 h-0.5 w-5 rounded-full bg-white" aria-hidden />
                ) : (
                  <span className="h-0.5 w-5" aria-hidden />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
      <span
        className="pointer-events-none absolute bottom-1 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/20"
        aria-hidden
      />
    </nav>
  )
}
