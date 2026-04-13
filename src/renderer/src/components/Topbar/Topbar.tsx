import { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { FiMenu, FiInfo, FiShare2, FiStar, FiMoreHorizontal } from 'react-icons/fi'
import { useNoteStore } from '@renderer/store/noteStore'
import { Breadcrumbs } from './Breadcrumbs'

export const Topbar = ({ className, ...props }: ComponentProps<'header'>): JSX.Element => {
  const toggleSidebar = useNoteStore((state) => state.toggleSidebar)

  return (
    <header
      className={twMerge(
        'h-[45px] flex items-center justify-between px-4 border-b border-notion-border bg-white',
        className
      )}
      {...props}
    >
      {/* Left section: hamburger + breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-notion-hover text-notion-text-secondary hover:text-notion-text transition-colors"
        >
          <FiMenu size={18} />
        </button>
        <Breadcrumbs />
      </div>

      {/* Right section: page actions */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-notion-hover text-notion-text-secondary hover:text-notion-text transition-colors"
          title="Page info"
        >
          <FiInfo size={16} />
        </button>
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-notion-hover text-notion-text-secondary hover:text-notion-text transition-colors"
          title="Share"
        >
          <FiShare2 size={16} />
        </button>
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-notion-hover text-notion-text-secondary hover:text-notion-text transition-colors"
          title="Star"
        >
          <FiStar size={16} />
        </button>
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-notion-hover text-notion-text-secondary hover:text-notion-text transition-colors"
          title="More options"
        >
          <FiMoreHorizontal size={16} />
        </button>
      </div>
    </header>
  )
}
