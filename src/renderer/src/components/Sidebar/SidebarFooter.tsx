import { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { FiPlus } from 'react-icons/fi'
import { useNoteStore } from '@renderer/store/noteStore'

export const SidebarFooter = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  const createPage = useNoteStore((state) => state.createPage)
  const selectPage = useNoteStore((state) => state.selectPage)
  const isBusy = useNoteStore(
    (state) => state.isCreating || state.isDeleting || state.isReading || state.isSaving
  )

  const handleNewPage = async () => {
    if (isBusy) return
    const newPageId = await createPage(null)
    if (newPageId) {
      await selectPage(newPageId)
    }
  }

  return (
    <div className={twMerge('px-2 py-2 border-t border-notion-border', className)} {...props}>
      <button
        type="button"
        onClick={handleNewPage}
        disabled={isBusy}
        className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-notion-text-secondary hover:bg-notion-hover hover:text-notion-text transition-colors"
      >
        <FiPlus size={16} />
        <span>New page</span>
      </button>
    </div>
  )
}
