import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { NOTEBOOK_ACTIONS, type NotebookAction } from './api'
import { InkPage } from './InkPage'
import { snapshot, type InkTool, type Rect } from './ink'
import { useInkNotebook } from './useInkNotebook'
import type { NotebookHandle } from './Notebook'

type Props = {
  topic: string; hidden: boolean; viewSwitch: ReactNode; disabled: boolean; actionsDisabled: boolean
  visionVerified: boolean; onSettings: () => void
  onAction: (text: string, action: NotebookAction, image?: string) => void
}
export const InkNotebook = forwardRef<NotebookHandle, Props>(function InkNotebook({ topic, hidden, viewSwitch, disabled, actionsDisabled, visionVerified, onSettings, onAction }, ref) {
  const notebook = useInkNotebook(topic)
  const [tool, setTool] = useState<InkTool>('pen'), [active, setActive] = useState('')
  const [selection, setSelection] = useState<{ id: string; rect: Rect } | null>(null)
  const [error, setError] = useState(''), [resolving, setResolving] = useState(false)
  const surface = useRef<HTMLDivElement>(null)
  const current = notebook.pages.find(page => page.id === active) ?? notebook.pages[0]
  const pageNumber = notebook.pages.findIndex(page => page.id === current?.id) + 1
  const rect = selection && selection.id === current?.id ? selection.rect : undefined
  useImperativeHandle(ref, () => ({ flush: notebook.flush }))
  function activate(id: string) { setActive(id); if (selection?.id !== id) setSelection(null) }
  function run(action: NotebookAction) {
    if (!current) return
    try {
      const image = snapshot(current, rect)
      setError('')
      onAction(`${rect ? 'Selection from handwritten' : 'Handwritten'} page ${pageNumber}`, action, image)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not capture this page.') }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, pages: notebook.pages }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'verso-ink-draft.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const conflict = notebook.pages.find(page => page.conflict)
  async function resolve(keep: boolean) {
    if (!conflict || !window.confirm(keep ? 'Replace the host’s ink page with this tablet draft?' : 'Discard this tablet draft and use the host’s page? Download your ink first if you want to keep both.')) return
    setResolving(true)
    try { await notebook.resolve(conflict.id, keep) } finally { setResolving(false) }
  }
  return <section className="notebook panel ink-notebook" aria-label="Persistent ink notebook" hidden={hidden}
    onKeyDown={event => {
      if (event.key === 'Escape') { setSelection(null); setTool('pen') }
      if (current && !disabled && !resolving && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); notebook.step(current.id, event.shiftKey)
      }
    }}>
    <div className="panel-heading notebook-heading">
      {viewSwitch}
      <div className="notebook-context-actions" role="group" aria-label="Ink notebook actions">
        {(Object.entries(NOTEBOOK_ACTIONS) as [NotebookAction, string][]).map(([action, label]) =>
          <button key={action} className="notebook-text-action" disabled={actionsDisabled || !visionVerified || !current?.strokes.length}
            title={`${label}: ${rect ? 'selected area' : 'current page'}`} aria-describedby="ink-action-scope" onClick={() => run(action)}>{label}</button>)}
      </div>
    </div>
    <div className="ink-tools" role="toolbar" aria-label="Ink tools">
      {(['pen', 'erase', 'select', 'move'] as InkTool[]).map(item => <button key={item} aria-pressed={tool === item}
        disabled={disabled || !notebook.loaded || resolving} onClick={() => { setTool(item); if (item !== 'select') setSelection(null) }}>
        {{ pen: 'Pen', erase: 'Eraser', select: 'Select', move: 'Move' }[item]}</button>)}
      <span className="notebook-action-divider">|</span>
      <button disabled={disabled || resolving || !current || !notebook.history(current.id).past.length} onClick={() => notebook.step(current.id, false)}>Undo</button>
      <button disabled={disabled || resolving || !current || !notebook.history(current.id).future.length} onClick={() => notebook.step(current.id, true)}>Redo</button>
      <button className="ink-add" disabled={disabled || resolving || !notebook.loaded} onClick={() => {
        activate(notebook.add()); setTool('pen')
        requestAnimationFrame(() => surface.current?.lastElementChild?.scrollIntoView({ block: 'start' }))
      }}>+ Page</button>
    </div>
    {!visionVerified && <p className="ink-help">Write freely. To ask about your handwriting, <button disabled={actionsDisabled} onClick={onSettings}>verify image support</button> in Model settings.</p>}
    {(error || notebook.error || conflict) && <div className="notice error" role="alert">
      <p>{error || notebook.error || 'This page changed on another device. Your tablet draft is preserved.'}</p>
      <button onClick={download}>Download ink draft</button>{' '}
      {conflict ? <><button disabled={resolving} onClick={() => void resolve(true)}>Keep tablet page</button>{' '}
        <button disabled={resolving} onClick={() => void resolve(false)}>Use host page</button></>
        : <button onClick={() => { setError(''); void notebook.retry() }}>Retry</button>}
    </div>}
    <div className="ink-pages" ref={surface} onScroll={() => {
      const container = surface.current!
      const top = container.getBoundingClientRect().top + container.clientHeight / 3
      const pages = [...container.querySelectorAll<HTMLElement>('.ink-page-wrap')]
      const visible = pages.find(page => page.getBoundingClientRect().bottom > top)
      if (visible?.dataset.id) activate(visible.dataset.id)
    }}>
      {notebook.pages.map((page, index) => <div className="ink-page-wrap" key={page.id} data-id={page.id}>
        <button className="ink-page-number" aria-current={page.id === current?.id ? 'page' : undefined} onClick={() => activate(page.id)}>Page {index + 1}</button>
        <InkPage page={page} number={index + 1} tool={tool} selected={selection?.id === page.id ? selection.rect : null}
          disabled={disabled || resolving} onActivate={() => activate(page.id)} onEdit={strokes => notebook.edit(page.id, strokes)}
          onSelect={next => setSelection(next ? { id: page.id, rect: next } : null)} onError={setError} />
      </div>)}
    </div>
    <footer className="notebook-status" aria-label="Ink notebook status">
      <span role="status" className={notebook.localError ? 'save-error' : ''}>{notebook.status}</span>
      <span>{notebook.loaded ? `Page ${pageNumber} of ${notebook.pages.length}` : ''}</span>
      <span id="ink-action-scope" className="notebook-action-scope">{rect ? 'selection' : 'page'}</span>
    </footer>
  </section>
})
