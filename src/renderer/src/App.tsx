import { useEffect } from 'react'
import { DraggableTopBar } from './components/DraggableTopBar'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { PageHeader } from './components/Editor/PageHeader'
import { BlockEditor } from './components/Editor/BlockEditor'
import { useNoteStore } from './store/noteStore'

function App(): JSX.Element {
  const hydrateNotes = useNoteStore((state) => state.hydrateNotes)
  const currentPageId = useNoteStore((state) => state.currentPageId)
  const createPage = useNoteStore((state) => state.createPage)
  const selectPage = useNoteStore((state) => state.selectPage)
  const isBusy = useNoteStore(
    (state) => state.isHydrating || state.isCreating || state.isDeleting || state.isReading || state.isSaving
  )

  useEffect(() => {
    void hydrateNotes()
  }, [hydrateNotes])

  const handleNewPage = async () => {
    if (isBusy) return
    const newPageId = await createPage(null)
    if (newPageId) {
      await selectPage(newPageId)
    }
  }

  return (
    <>
      <DraggableTopBar />

      <main className="flex h-full bg-white">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <Topbar />

          {/* Editor area */}
          <div className="flex-1 overflow-y-auto bg-white">
            {currentPageId ? (
              <div className="min-h-full">
                <PageHeader />
                <BlockEditor />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="text-6xl">📝</div>
                  <h2 className="text-2xl font-bold text-notion-text">Welcome to NoteMark</h2>
                  <p className="text-notion-text-secondary">
                    Select a page from the sidebar or create a new one
                  </p>
                  <button
                    type="button"
                    onClick={handleNewPage}
                    disabled={isBusy}
                    className="px-4 py-2 bg-notion-text text-white rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Create your first page
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}

export default App
