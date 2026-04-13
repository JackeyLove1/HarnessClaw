import { create } from 'zustand'

export type NoteInfo = {
  title: string
  lastEditTime: number
}

export type PageTreeItem = {
  id: string
  title: string
  parentId: string | null
  children: string[]
  emoji: string | null
  cover: string | null
  lastEditTime: number
}

export type NoteStoreState = {
  notes: NoteInfo[]
  pages: PageTreeItem[]
  pageOrder: string[]
  currentNoteId: string | null
  currentPageId: string | null
  currentNoteContent: string
  draftContent: string
  hasUnsavedChanges: boolean
  isHydrating: boolean
  isReading: boolean
  isSaving: boolean
  isCreating: boolean
  isDeleting: boolean
  error: string | null
  sidebarCollapsed: boolean
  sidebarWidth: number
}

export type NoteStoreActions = {
  hydrateNotes: () => Promise<void>
  selectNote: (noteId: string) => Promise<void>
  selectPage: (pageId: string) => Promise<void>
  setDraftContent: (content: string) => void
  saveCurrentNote: () => Promise<boolean>
  createNote: () => Promise<void>
  createPage: (parentId: string | null, title?: string) => Promise<string>
  deleteCurrentNote: () => Promise<void>
  deletePage: (pageId: string) => Promise<void>
  updatePageMeta: (pageId: string, updates: Partial<Pick<PageTreeItem, 'title' | 'emoji' | 'cover'>>) => void
  movePage: (pageId: string, newParentId: string | null, index: number) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  reloadNotes: () => Promise<void>
  clearError: () => void
  getChildPages: (parentId: string | null) => PageTreeItem[]
  getPagePath: (pageId: string) => PageTreeItem[]
}

export type NoteStore = NoteStoreState & NoteStoreActions

type NoteContextBridge = {
  getNotes: () => Promise<unknown[]>
  readNote: (title: string) => Promise<string | undefined>
  writeNote: (title: string, content: string) => Promise<void>
  createNote: () => Promise<unknown>
  deleteNote: (title: string) => Promise<boolean>
}

const emptyEditorState = {
  currentNoteId: null,
  currentPageId: null,
  currentNoteContent: '',
  draftContent: '',
  hasUnsavedChanges: false
} satisfies Pick<
  NoteStoreState,
  'currentNoteId' | 'currentPageId' | 'currentNoteContent' | 'draftContent' | 'hasUnsavedChanges'
>

const getNoteContext = (): NoteContextBridge => {
  return (window as Window & { context: NoteContextBridge }).context
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return 'Unexpected note operation failure'
}

const normalizeTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsedNumber = Number(value)

    if (Number.isFinite(parsedNumber)) {
      return parsedNumber
    }

    const parsedDate = Date.parse(value)

    if (Number.isFinite(parsedDate)) {
      return parsedDate
    }
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  return Date.now()
}

const normalizeTitle = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const title = value.trim()

  return title ? title : null
}

const normalizeNoteInfo = (value: unknown): NoteInfo | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  const title = normalizeTitle(candidate.title ?? candidate.name ?? candidate.fileName)

  if (!title) {
    return null
  }

  return {
    title,
    lastEditTime: normalizeTimestamp(
      candidate.lastEditTime ??
        candidate.updatedAt ??
        candidate.modifiedAt ??
        candidate.mtimeMs ??
        candidate.mtime
    )
  }
}

const sortNotes = (notes: NoteInfo[]): NoteInfo[] => {
  return [...notes].sort((left, right) => right.lastEditTime - left.lastEditTime)
}

const normalizeNotes = (notes: unknown[]): NoteInfo[] => {
  return sortNotes(notes.map(normalizeNoteInfo).filter((note): note is NoteInfo => note !== null))
}

let activeReadRequest = 0

export const useNoteStore = create<NoteStore>((set, get) => {
  const readNoteIntoEditor = async (noteId: string): Promise<void> => {
    const requestId = ++activeReadRequest

    set({ isReading: true, error: null })

    try {
      const content = (await getNoteContext().readNote(noteId)) ?? ''

      if (requestId !== activeReadRequest) {
        return
      }

      set({
        currentNoteId: noteId,
        currentPageId: noteId,
        currentNoteContent: content,
        draftContent: content,
        hasUnsavedChanges: false,
        isReading: false,
        isHydrating: false,
        error: null
      })
    } catch (error) {
      if (requestId !== activeReadRequest) {
        return
      }

      set({
        isReading: false,
        isHydrating: false,
        error: getErrorMessage(error)
      })
    }
  }

  const fetchNotes = async (): Promise<NoteInfo[]> => {
    const notes = await getNoteContext().getNotes()

    return normalizeNotes(Array.isArray(notes) ? notes : [])
  }

  return {
    notes: [],
    pages: [],
    pageOrder: [],
    ...emptyEditorState,
    isHydrating: false,
    isReading: false,
    isSaving: false,
    isCreating: false,
    isDeleting: false,
    error: null,
    sidebarCollapsed: false,
    sidebarWidth: 260,

    hydrateNotes: async () => {
      if (get().isHydrating) {
        return
      }

      set({ isHydrating: true, error: null })

      try {
        const notes = await fetchNotes()
        const currentNoteId = get().currentNoteId
        const nextNoteId =
          (currentNoteId && notes.some((note) => note.title === currentNoteId)
            ? currentNoteId
            : null) ?? notes[0]?.title

        set({ notes })

        // Build page tree from flat notes
        const pages: PageTreeItem[] = notes.map((note) => ({
          id: note.title,
          title: note.title,
          parentId: null,
          children: [],
          emoji: null,
          cover: null,
          lastEditTime: note.lastEditTime
        }))
        const pageOrder = pages.map((p) => p.id)
        set({ pages, pageOrder })

        if (!nextNoteId) {
          set({
            ...emptyEditorState,
            isHydrating: false,
            isReading: false
          })

          return
        }

        await readNoteIntoEditor(nextNoteId)
      } catch (error) {
        set({
          isHydrating: false,
          isReading: false,
          error: getErrorMessage(error)
        })
      }
    },

    selectNote: async (noteId) => {
      if (!noteId || noteId === get().currentNoteId) {
        return
      }

      if (!get().notes.some((note) => note.title === noteId)) {
        return
      }

      if (get().hasUnsavedChanges) {
        const didSave = await get().saveCurrentNote()

        if (!didSave) {
          return
        }
      }

      await readNoteIntoEditor(noteId)
    },

    setDraftContent: (content) => {
      set((state) => ({
        draftContent: content,
        hasUnsavedChanges: content !== state.currentNoteContent
      }))
    },

    saveCurrentNote: async () => {
      const { currentNoteId, draftContent, hasUnsavedChanges } = get()

      if (!currentNoteId || !hasUnsavedChanges) {
        return true
      }

      set({ isSaving: true, error: null })

      try {
        await getNoteContext().writeNote(currentNoteId, draftContent)

        set((state) => ({
          isSaving: false,
          currentNoteContent: draftContent,
          draftContent,
          hasUnsavedChanges: false,
          error: null,
          notes: sortNotes(
            state.notes.map((note) =>
              note.title === currentNoteId ? { ...note, lastEditTime: Date.now() } : note
            )
          )
        }))

        return true
      } catch (error) {
        set({
          isSaving: false,
          error: getErrorMessage(error)
        })

        return false
      }
    },

    createNote: async () => {
      if (get().isCreating) {
        return
      }

      const previousTitles = new Set(get().notes.map((note) => note.title))

      set({ isCreating: true, error: null })

      try {
        const createdNote = await getNoteContext().createNote()
        const refreshedNotes = await fetchNotes()
        const createdTitle =
          normalizeTitle(
            createdNote && typeof createdNote === 'object'
              ? (createdNote as Record<string, unknown>).title
              : createdNote
          ) ??
          refreshedNotes.find((note) => !previousTitles.has(note.title))?.title ??
          refreshedNotes[0]?.title

        set({
          notes: refreshedNotes,
          isCreating: false,
          error: null
        })

        if (!createdTitle) {
          set({
            ...emptyEditorState
          })

          return
        }

        await readNoteIntoEditor(createdTitle)
      } catch (error) {
        set({
          isCreating: false,
          error: getErrorMessage(error)
        })
      }
    },

    deleteCurrentNote: async () => {
      const { currentNoteId, notes, isDeleting } = get()

      if (!currentNoteId || isDeleting) {
        return
      }

      const currentIndex = notes.findIndex((note) => note.title === currentNoteId)
      const fallbackSelection =
        notes[currentIndex + 1]?.title ?? notes[currentIndex - 1]?.title ?? null

      set({ isDeleting: true, error: null })

      try {
        await getNoteContext().deleteNote(currentNoteId)

        const refreshedNotes = await fetchNotes()
        const nextNoteId =
          (fallbackSelection &&
          refreshedNotes.some((note) => note.title === fallbackSelection)
            ? fallbackSelection
            : null) ?? refreshedNotes[0]?.title

        set({
          notes: refreshedNotes,
          isDeleting: false,
          error: null
        })

        if (!nextNoteId) {
          set({
            ...emptyEditorState
          })

          return
        }

        await readNoteIntoEditor(nextNoteId)
      } catch (error) {
        set({
          isDeleting: false,
          error: getErrorMessage(error)
        })
      }
    },

    reloadNotes: async () => {
      set({ isHydrating: true, error: null })

      try {
        const refreshedNotes = await fetchNotes()
        const currentNoteId = get().currentNoteId
        const currentStillExists =
          currentNoteId !== null &&
          refreshedNotes.some((note) => note.title === currentNoteId)

        set({
          notes: refreshedNotes,
          isHydrating: false
        })

        if (!refreshedNotes.length) {
          set({
            ...emptyEditorState
          })

          return
        }

        if (!currentStillExists) {
          await readNoteIntoEditor(refreshedNotes[0].title)
        }
      } catch (error) {
        set({
          isHydrating: false,
          error: getErrorMessage(error)
        })
      }
    },

    clearError: () => set({ error: null }),

    selectPage: async (pageId) => {
      if (!pageId || pageId === get().currentPageId) {
        return
      }

      const page = get().pages.find((p) => p.id === pageId)
      if (!page) {
        return
      }

      if (get().hasUnsavedChanges) {
        const didSave = await get().saveCurrentNote()
        if (!didSave) {
          return
        }
      }

      await readNoteIntoEditor(pageId)
    },

    createPage: async (parentId, title) => {
      const newPageId = title || `Untitled-${Date.now()}`

      const newPage: PageTreeItem = {
        id: newPageId,
        title: newPageId,
        parentId,
        children: [],
        emoji: null,
        cover: null,
        lastEditTime: Date.now()
      }

      // Also create the actual file via IPC
      try {
        await getNoteContext().writeNote(newPageId, '')
      } catch {
        // File might already exist, continue anyway
      }

      set((state) => {
        const newPages = [...state.pages, newPage]
        let newPageOrder = [...state.pageOrder]
        let newPagesWithChild = newPages

        if (parentId) {
          newPagesWithChild = newPages.map((p) =>
            p.id === parentId ? { ...p, children: [...p.children, newPageId] } : p
          )
        } else {
          newPageOrder = [...newPageOrder, newPageId]
        }

        // Also update the notes list
        const newNotes = [...state.notes, { title: newPageId, lastEditTime: Date.now() }]

        return {
          pages: newPagesWithChild,
          pageOrder: newPageOrder,
          notes: newNotes
        }
      })

      return newPageId
    },

    deletePage: async (pageId) => {
      const page = get().pages.find((p) => p.id === pageId)
      if (!page) return

      // Remove from parent's children
      if (page.parentId) {
        set((state) => ({
          pages: state.pages.map((p) =>
            p.id === page.parentId
              ? { ...p, children: p.children.filter((id) => id !== pageId) }
              : p
          )
        }))
      }

      // Remove page and its descendants
      const idsToRemove = new Set<string>()
      const collectDescendants = (id: string) => {
        idsToRemove.add(id)
        const p = get().pages.find((pg) => pg.id === id)
        p?.children.forEach(collectDescendants)
      }
      collectDescendants(pageId)

      set((state) => ({
        pages: state.pages.filter((p) => !idsToRemove.has(p.id)),
        pageOrder: state.pageOrder.filter((id) => !idsToRemove.has(id))
      }))

      if (get().currentPageId === pageId) {
        const remaining = get().pages[0]
        if (remaining) {
          await readNoteIntoEditor(remaining.id)
        } else {
          set({ ...emptyEditorState })
        }
      }
    },

    updatePageMeta: (pageId, updates) => {
      set((state) => ({
        pages: state.pages.map((p) =>
          p.id === pageId ? { ...p, ...updates, lastEditTime: Date.now() } : p
        )
      }))
    },

    movePage: (pageId, newParentId, index) => {
      const page = get().pages.find((p) => p.id === pageId)
      if (!page) return

      // Remove from old parent
      if (page.parentId) {
        set((state) => ({
          pages: state.pages.map((p) =>
            p.id === page.parentId
              ? { ...p, children: p.children.filter((id) => id !== pageId) }
              : p
          )
        }))
      } else {
        set((state) => ({
          pageOrder: state.pageOrder.filter((id) => id !== pageId)
        }))
      }

      // Add to new parent
      set((state) => {
        let newPages = state.pages.map((p) => {
          if (p.id === pageId) {
            return { ...p, parentId: newParentId }
          }
          if (p.id === newParentId) {
            const newChildren = [...p.children]
            newChildren.splice(index, 0, pageId)
            return { ...p, children: newChildren }
          }
          return p
        })

        if (!newParentId) {
          const newPageOrder = [...state.pageOrder]
          newPageOrder.splice(index, 0, pageId)
          return { pages: newPages, pageOrder: newPageOrder }
        }

        return { pages: newPages }
      })
    },

    toggleSidebar: () => {
      set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
    },

    setSidebarWidth: (width) => {
      set({ sidebarWidth: Math.min(400, Math.max(200, width)) })
    },

    getChildPages: (parentId) => {
      const { pages } = get()
      if (parentId === null) {
        return pages.filter((p) => p.parentId === null)
      }
      return pages.filter((p) => p.parentId === parentId)
    },

    getPagePath: (pageId) => {
      const { pages } = get()
      const path: PageTreeItem[] = []
      let current = pages.find((p) => p.id === pageId)

      while (current) {
        path.unshift(current)
        current = current.parentId ? pages.find((p) => p.id === current!.parentId) : undefined
      }

      return path
    }
  }
})

export const selectNoteList = (state: NoteStoreState): NoteInfo[] => state.notes

export const selectCurrentNote = (state: NoteStoreState): NoteInfo | null => {
  if (!state.currentNoteId) {
    return null
  }

  return state.notes.find((note) => note.title === state.currentNoteId) ?? null
}

export const selectIsBusy = (state: NoteStoreState): boolean => {
  return (
    state.isHydrating ||
    state.isReading ||
    state.isSaving ||
    state.isCreating ||
    state.isDeleting
  )
}
