export const DraggableTopBar = () => {
  return (
    <header className="absolute top-0 right-0 left-0 z-50 flex h-8 items-center justify-end bg-transparent px-1 ">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Minimize window"
          onClick={() => void window.context.windowMinimize()}
          className="h-6 w-10 rounded text-xs text-zinc-200 transition hover:bg-white/10"
        >
          -
        </button>
        <button
          type="button"
          aria-label="Toggle maximize window"
          onClick={() => void window.context.windowToggleMaximize()}
          className="h-6 w-10 rounded text-[10px] text-zinc-200 transition hover:bg-white/10"
        >
          []
        </button>
        <button
          type="button"
          aria-label="Close window"
          onClick={() => void window.context.windowClose()}
          className="h-6 w-10 rounded text-xs text-zinc-200 transition hover:bg-red-500/80 hover:text-white"
        >
          x
        </button>
      </div>
    </header>
  )
}
