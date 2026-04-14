import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import * as DraggableTopBarModule from '../components/DraggableTopBar'

const DraggableTopBar = DraggableTopBarModule.DraggableTopBar ?? (() => null)

const iconClassName =
  'h-9 w-9 rounded-2xl border border-[var(--border-soft)] bg-white/80 text-[var(--ink-subtle)] shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition hover:-translate-y-0.5 hover:text-[var(--ink-main)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.06)]'

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M7 18 3 21V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7Z" />
    <path d="M8 10h8" />
    <path d="M8 14h5" />
  </svg>
)

const TaskIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="12" cy="12" r="8" />
    <path d="m9.5 12 1.8 1.8 3.7-4.1" />
  </svg>
)

interface NavRailLinkProps {
  label: string
  to: string
  children: ReactNode
}

const NavRailLink = ({ label, to, children }: NavRailLinkProps) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-[11px] font-medium transition ${
        isActive
          ? 'bg-white text-[var(--ink-main)] shadow-[0_4px_16px_rgba(0,0,0,0.06)]'
          : 'text-[var(--ink-faint)] hover:text-[var(--ink-main)]'
      }`
    }
  >
    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f5f5f7]">{children}</span>
    <span>{label}</span>
  </NavLink>
)

export const AppShell = () => {
  return (
    <>
      <DraggableTopBar />

      <main className="h-screen overflow-hidden bg-[var(--app-bg)] px-4 pb-4 pt-10 text-[var(--ink-main)]">
        <div className="notemark-shell grid h-full overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--shell-bg)] shadow-[var(--shadow-shell)]">
          <aside className="flex h-full flex-col justify-between border-r border-[var(--border-soft)] bg-[var(--rail-bg)] px-3 py-4 backdrop-blur-xl">
            <div className="space-y-4">
              <button type="button" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1a1a1a] text-white shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
                <span className="text-[22px]">🦅</span>
              </button>

              <div className="space-y-1">
                <NavRailLink label="对话" to="/chat">
                  <ChatIcon />
                </NavRailLink>
                <NavRailLink label="任务" to="/tasks">
                  <TaskIcon />
                </NavRailLink>
              </div>
            </div>

            <div className="space-y-2">
              <button type="button" className={iconClassName} aria-label="帮助">
                <span className="text-[15px] font-medium">?</span>
              </button>
              <button type="button" className={iconClassName} aria-label="设备">
                <span className="text-[15px]">◐</span>
              </button>
              <button type="button" className={iconClassName} aria-label="设置">
                <span className="text-[15px]">⚙</span>
              </button>
              <button type="button" className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#34c759] text-white shadow-[0_4px_12px_rgba(52,199,89,0.3)]" aria-label="在线状态">
                <span className="text-[14px]">↑</span>
              </button>
            </div>
          </aside>

          <div className="col-span-2 flex min-w-0 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </main>
    </>
  )
}
