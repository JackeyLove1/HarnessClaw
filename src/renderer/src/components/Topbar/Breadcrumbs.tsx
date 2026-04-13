import { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { FiChevronRight } from 'react-icons/fi'
import { useNoteStore, PageTreeItem } from '@renderer/store/noteStore'

export const Breadcrumbs = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  const currentPageId = useNoteStore((state) => state.currentPageId)
  const getPagePath = useNoteStore((state) => state.getPagePath)
  const selectPage = useNoteStore((state) => state.selectPage)

  const path = currentPageId ? getPagePath(currentPageId) : []

  if (path.length === 0) {
    return (
      <div className={twMerge('flex items-center gap-1 text-sm text-notion-text-secondary', className)} {...props}>
        <span>No page selected</span>
      </div>
    )
  }

  return (
    <div className={twMerge('flex items-center gap-1 text-sm', className)} {...props}>
      {path.map((item, index) => (
        <span key={item.id} className="flex items-center gap-1">
          {index > 0 && <FiChevronRight size={14} className="text-notion-text-tertiary" />}
          <button
            type="button"
            onClick={() => void selectPage(item.id)}
            className={twMerge(
              'hover:text-notion-text transition-colors',
              index === path.length - 1 ? 'text-notion-text font-medium' : 'text-notion-text-secondary'
            )}
          >
            {item.emoji && <span className="mr-1">{item.emoji}</span>}
            {item.title}
          </button>
        </span>
      ))}
    </div>
  )
}
