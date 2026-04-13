import { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { FiClock, FiFileText, FiSettings } from 'react-icons/fi'

export const SidebarNav = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  return (
    <div className={twMerge('px-2 pb-2', className)} {...props}>
      <button
        type="button"
        className="sidebar-nav-item w-full"
      >
        <FiClock size={16} />
        <span>Recent</span>
      </button>
      <button
        type="button"
        className="sidebar-nav-item w-full"
      >
        <FiFileText size={16} />
        <span>All Pages</span>
      </button>
      <button
        type="button"
        className="sidebar-nav-item w-full"
      >
        <FiSettings size={16} />
        <span>Settings & Members</span>
      </button>
    </div>
  )
}
