import {
    BlockTypeSelect,
    BoldItalicUnderlineToggles,
    headingsPlugin,
    listsPlugin,
    markdownShortcutPlugin,
    MDXEditor,
    quotePlugin,
    thematicBreakPlugin,
    toolbarPlugin,
    UndoRedo
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { useNoteStore } from '@renderer/store/noteStore';
import { cn } from '@renderer/utils';
import { ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';

export const BlockEditor = ({ className, ...props }: ComponentProps<'div'>): JSX.Element => {
  const currentPageId = useNoteStore((state) => state.currentPageId)
  const draftContent = useNoteStore((state) => state.draftContent)
  const setDraftContent = useNoteStore((state) => state.setDraftContent)
  const saveCurrentNote = useNoteStore((state) => state.saveCurrentNote)

  if (!currentPageId) {
    return <div className={twMerge('', className)} {...props} />
  }

  const handleChange = (content: string) => {
    setDraftContent(content)
  }

  const handleBlur = async () => {
    await saveCurrentNote()
  }

  return (
    <div className={twMerge('max-w-[900px] mx-auto px-[90px] py-4', className)} {...props}>
      <MDXEditor
        key={currentPageId}
        markdown={draftContent}
        onChange={handleChange}
        onBlur={handleBlur}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <BlockTypeSelect />
                <BoldItalicUnderlineToggles />
              </>
            )
          })
        ]}
        contentEditableClassName={cn(
          'outline-none min-h-[calc(100vh-20rem)]',
          'text-[16px] leading-[1.6]',
          'text-notion-text',
          'prose-notion',
          'focus:outline-none'
        )}
        className="bg-transparent"
      />
    </div>
  )
}
