import { ComponentProps, useCallback, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import { useNoteStore } from '@renderer/store/noteStore'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNav } from './SidebarNav'
import { PageTree } from './PageTree'
import { SidebarFooter } from './SidebarFooter'

export const Sidebar = ({ className, ...props }: ComponentProps<'aside'>): JSX.Element => {
  const sidebarWidth = useNoteStore((state) => state.sidebarWidth)
  const sidebarCollapsed = useNoteStore((state) => state.sidebarCollapsed)
  const setSidebarWidth = useNoteStore((state) => state.setSidebarWidth)
  const isResizing = useRef(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizing.current = true

      const startX = e.clientX
      const startWidth = sidebarWidth

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing.current) return
        const delta = e.clientX - startX
        const newWidth = startWidth + delta
        setSidebarWidth(newWidth)
      }

      const handleMouseUp = () => {
        isResizing.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [sidebarWidth, setSidebarWidth]
  )

  if (sidebarCollapsed) {
    return <aside className={twMerge('h-full bg-notion-sidebar', className)} {...props} />
  }

  return (
    <aside
      ref={sidebarRef}
      className={twMerge(
        'relative h-full bg-notion-sidebar flex flex-col border-r border-notion-border',
        className
      )}
      style={{ width: sidebarWidth }}
      {...props}
    >
      <SidebarHeader />
      <SidebarNav />
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <PageTree />
      </div>
      <SidebarFooter />

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-notion-border transition-colors"
        onMouseDown={handleMouseDown}
      />
    </aside>
  )
}
