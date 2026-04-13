import {
    ActionButtonsRow,
    Content,
    DraggableTopBar,
    FloatingNoteTitle,
    MarkdownEditor,
    NotePreviewList,
    RootLayout,
    Sidebar
} from '@/components';
import { useRef } from 'react';

const App = () => {
  const contentContainerRef = useRef<HTMLDivElement>(null)

  const resetScroll = () => {
    contentContainerRef.current?.scrollTo(0, 0)
  }

  return (
    <>
      <DraggableTopBar />
      {/* Decorative background gradient */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-indigo-950" />
        <div className="absolute bottom-0 left-1/4 w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-blue-900/15 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] bg-indigo-900/20 rounded-full blur-[80px] pointer-events-none" />
      </div>
      <RootLayout className="relative z-10">
        <Sidebar className="p-2">
          <ActionButtonsRow className="flex justify-between mt-1" />
          <NotePreviewList className="mt-3 space-y-1" onSelect={resetScroll} />
        </Sidebar>

        <Content ref={contentContainerRef}>
          <FloatingNoteTitle className="pt-2" />
          <MarkdownEditor />
        </Content>
      </RootLayout>
    </>
  )
}

export default App
