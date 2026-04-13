import { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { FiSearch, FiChevronDown } from 'react-icons/fi'

export const SidebarHeader = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  return (
    <div className={twMerge('px-3 py-4', className)} {...props}>
      {/* Workspace switcher */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm font-semibold">
          J
        </div>
        <span className="text-sm font-medium text-notion-text flex-1">Jackey Workspace</span>
        <FiChevronDown className="text-notion-text-secondary" size={16} />
      </div>

      {/* Search button */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 rounded text-notion-text-secondary hover:bg-notion-hover text-sm transition-colors"
      >
        <FiSearch size={16} />
        <span className="flex-1 text-left">Search</span>
        <kbd className="text-xs bg-notion-hover px-1.5 py-0.5 rounded border border-notion-border">
          ⌘K
        </kbd>
      </button>
    </div>
  )
}
