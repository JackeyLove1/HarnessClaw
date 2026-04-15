import { CircleCheckBig, CircleHelp, MessageCircleMore, MonitorSmartphone, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import appIcon from '../assets/icon.png';
import * as DraggableTopBarModule from '../components/DraggableTopBar';

const DraggableTopBar = DraggableTopBarModule.DraggableTopBar ?? (() => null)

const navIconClassName = 'h-4 w-4 stroke-2 transition-all group-aria-[current=page]:stroke-[2.7]'
const utilityIconClassName = 'h-4 w-4 stroke-2 transition-all group-active:stroke-[2.7]'
const utilityButtonClassName =
  'group flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--border-soft)] bg-white text-[var(--ink-subtle)] shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-all hover:bg-[#ececf2] hover:text-[var(--ink-main)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)] active:bg-[#dfdfe8] active:text-[var(--ink-main)]'

interface NavRailLinkProps {
  label: string
  to: string
  icon: ReactNode
}

const NavRailLink = ({ label, to, icon }: NavRailLinkProps) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `group flex flex-col items-center gap-0.5 rounded-2xl px-2 py-3 text-[11px] font-semibold transition-all ${
        isActive
          ? 'bg-[#f4f4f8] text-[var(--ink-main)] shadow-[0_6px_18px_rgba(0,0,0,0.08)]'
          : 'text-[var(--ink-faint)] hover:bg-[#f6f6f9] hover:text-[var(--ink-main)]'
      }`
    }
  >
    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent bg-white shadow-[0_3px_10px_rgba(0,0,0,0.05)] transition-all group-hover:bg-[#ececf2] group-active:bg-[#e4e4eb] group-aria-[current=page]:bg-[#ebebf0]">
      {icon}
    </span>
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
              <button type="button" className="mx-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                <img src={appIcon} alt="NoteMark App icon" className="h-full w-full object-cover" />
              </button>

              <div className="space-y-1">
                <NavRailLink label="对话" to="/chat" icon={<MessageCircleMore className={navIconClassName} />} />
                <NavRailLink label="任务" to="/tasks" icon={<CircleCheckBig className={navIconClassName} />} />
              </div>
            </div>

            <div className="space-y-2">
              <button type="button" className={utilityButtonClassName} aria-label="帮助">
                <CircleHelp className={utilityIconClassName} />
              </button>
              <button type="button" className={utilityButtonClassName} aria-label="设备">
                <MonitorSmartphone className={utilityIconClassName} />
              </button>
              <button type="button" className={utilityButtonClassName} aria-label="设置">
                <Settings className={utilityIconClassName} />
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
