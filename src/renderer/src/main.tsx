import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './assets/index.css'

const escapeHtml = (message: string): string =>
  message.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char))

const renderFatalError = (message: string): void => {
  const existing = document.getElementById('notemark-fatal-error')
  if (existing) {
    existing.querySelector('pre')!.innerHTML = escapeHtml(message)
    return
  }

  const overlay = document.createElement('div')
  overlay.id = 'notemark-fatal-error'
  overlay.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(248,247,244,0.96);color:#171717;font-family:ui-sans-serif,system-ui,sans-serif;'
  )
  overlay.innerHTML = `
    <section style="max-width:840px;width:100%;border:1px dashed #d4d4d4;border-radius:24px;padding:24px;background:white;box-shadow:0 20px 60px rgba(0,0,0,0.06);">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#737373;">Renderer Error</div>
      <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;">NoteMark failed to render.</h1>
      <pre style="margin-top:16px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#404040;">${escapeHtml(message)}</pre>
    </section>
  `
  document.body.appendChild(overlay)
}

window.addEventListener('error', (event) => {
  renderFatalError(event.error?.stack || event.message || 'Unknown renderer error')
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason)
  renderFatalError(reason)
})

void import('./App')
  .then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <HashRouter>
        <App />
      </HashRouter>
    )
  })
  .catch((error) => {
    renderFatalError(error instanceof Error ? error.stack || error.message : String(error))
  })
