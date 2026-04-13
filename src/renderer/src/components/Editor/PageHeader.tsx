import { ComponentProps, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { useNoteStore } from '@renderer/store/noteStore'

export const PageHeader = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  const currentPageId = useNoteStore((state) => state.currentPageId)
  const pages = useNoteStore((state) => state.pages)
  const updatePageMeta = useNoteStore((state) => state.updatePageMeta)
  const page = pages.find((p) => p.id === currentPageId)

  const [isEditingEmoji, setIsEditingEmoji] = useState(false)

  if (!page) {
    return <div className={twMerge('', className)} {...props} />
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updatePageMeta(page.id, { title: e.target.value })
  }

  const handleEmojiClick = () => {
    setIsEditingEmoji(!isEditingEmoji)
  }

  return (
    <div className={twMerge('max-w-[900px] mx-auto px-[90px] pt-12 pb-4', className)} {...props}>
      {/* Cover image */}
      {page.cover && (
        <div className="mb-6 -mx-[90px]">
          <img src={page.cover} alt="Cover" className="w-full h-[200px] object-cover rounded" />
        </div>
      )}

      {/* Emoji */}
      {page.emoji && (
        <button
          type="button"
          onClick={handleEmojiClick}
          className="text-6xl mb-2 hover:opacity-80 transition-opacity"
        >
          {page.emoji}
        </button>
      )}

      {/* Title */}
      <input
        type="text"
        value={page.title}
        onChange={handleTitleChange}
        placeholder="Untitled"
        className="w-full text-[40px] font-bold leading-tight border-none bg-transparent outline-none text-notion-text placeholder:text-notion-text-tertiary"
      />
    </div>
  )
}
