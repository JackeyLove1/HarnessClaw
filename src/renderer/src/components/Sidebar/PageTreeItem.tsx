import { ComponentProps, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { FiChevronRight, FiPlus, FiMoreHorizontal } from 'react-icons/fi'
import { PageTreeItem as PageTreeItemType, useNoteStore } from '@renderer/store/noteStore'
import { cn } from '@renderer/utils'

interface PageTreeItemProps extends ComponentProps<'div'> {
  page: PageTreeItemType
  depth: number
}

export const PageTreeItem = ({ page, depth, className, ...props }: PageTreeItemProps): JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(true)
  const currentPageId = useNoteStore((state) => state.currentPageId)
  const selectPage = useNoteStore((state) => state.selectPage)
  const createPage = useNoteStore((state) => state.createPage)
  const pages = useNoteStore((state) => state.pages)

  const hasChildren = page.children.length > 0
  const isActive = page.id === currentPageId

  const childPages = page.children
    .map((id) => pages.find((p) => p.id === id))
    .filter((p): p is PageTreeItemType => p !== undefined)

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newPageId = await createPage(page.id)
    if (newPageId) {
      await selectPage(newPageId)
    }
  }

  return (
    <div className={cn('', className)} {...props}>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded cursor-pointer group transition-colors',
          isActive ? 'bg-notion-hover' : 'hover:bg-notion-hover',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => void selectPage(page.id)}
      >
        {/* Expand/collapse chevron */}
        <button
          type="button"
          className={cn(
            'w-4 h-4 flex items-center justify-center transition-transform',
            hasChildren ? 'text-notion-text-tertiary hover:text-notion-text' : 'invisible'
          )}
          style={{ transform: isExpanded && hasChildren ? 'rotate(90deg)' : 'rotate(0deg)' }}
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
        >
          <FiChevronRight size={12} />
        </button>

        {/* Emoji or page icon */}
        <span className="text-sm">{page.emoji || '📄'}</span>

        {/* Title */}
        <span className="flex-1 text-sm truncate text-notion-text">{page.title}</span>

        {/* Action buttons - shown on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-notion-hover-secondary text-notion-text-secondary hover:text-notion-text transition-colors"
            onClick={handleAddChild}
          >
            <FiPlus size={12} />
          </button>
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-notion-hover-secondary text-notion-text-secondary hover:text-notion-text transition-colors"
          >
            <FiMoreHorizontal size={12} />
          </button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="transition-all">
          {childPages.map((child) => (
            <PageTreeItem key={child.id} page={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
