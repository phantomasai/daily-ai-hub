import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav.jsx'

export default function AppLayout() {
  return (
    <div className="min-h-svh bg-[#0a0a0f] font-sans text-zinc-100 antialiased">
      <div className="mx-auto flex min-h-svh w-full max-w-[430px] flex-col shadow-[0_0_80px_rgba(0,0,0,0.35)]">
        <main className="flex-1 px-4 pb-[calc(5.75rem+max(0.75rem,env(safe-area-inset-bottom)))] pt-6">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  )
}
