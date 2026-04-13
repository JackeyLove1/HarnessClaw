import { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { useNoteStore, PageTreeItem as PageTreeItemType } from '@renderer/store/noteStore'
import { PageTreeItem } from './PageTreeItem'

export const PageTree = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  const pages = useNoteStore((state) => state.pages)
  const pageOrder = useNoteStore((state) => state.pageOrder)
  const rootPages = pageOrder
    .map((id) => pages.find((p) => p.id === id))
    .filter((p): p is PageTreeItemType => p !== undefined)

  return (
    <div className={twMerge('', className)} {...props}>
      {rootPages.map((page) => (
        <PageTreeItem key={page.id} page={page} depth={0} />
      ))}
      {rootPages.length === 0 && (
        <p className="text-sm text-notion-text-secondary px-3 py-2">No pages yet</p>
      )}
    </div>
  )
}
