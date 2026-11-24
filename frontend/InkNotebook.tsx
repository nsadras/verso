import { forwardRef, useImperativeHandle, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { NOTEBOOK_ACTIONS, type NotebookAction } from './api'
import { InkCanvas, type InkCanvasHandle } from './InkCanvas'
import { readCamera, snapshot, visibleStrokes, type InkPageData, type InkView, type InkTool, type Rect } from './ink'
import { useInkNotebook } from './useInkNotebook'
import type { NotebookHandle } from './Notebook'

type Props = {
  topic: string; hidden: boolean; viewSwitch: ReactNode; disabled: boolean; actionsDisabled: boolean
  visionVerified: boolean; onSettings: () => void
  conversionNotice: ReactNode; conversionDisabled: boolean
  onConvert: (pages: InkPageData[], selection: Rect | null) => void
  onInteraction: (active: boolean) => void
  onAction: (text: string, action: NotebookAction, image?: string) => void
}
export const InkNotebook = forwardRef<NotebookHandle, Props>(function InkNotebook({ topic, hidden, viewSwitch, disabled, actionsDisabled, visionVerified, onSettings, onAction, conversionNotice, conversionDisabled, onConvert, onInteraction }, ref) {
  const notebook = useInkNotebook(topic)
  const [tool, setTool] = useState<InkTool>('pen')
  const [selection, setSelection] = useState<Rect | null>(null)
  const [initialView] = useState(() => readCamera(topic))
  const [view, setView] = useState<InkView>({ ...initialView, width: 0, height: 0 })
  const [error, setError] = useState(''), [resolving, setResolving] = useState(false)
  const surface = useRef<InkCanvasHandle>(null)
  const pointers = useRef(new Set<number>())
  function endInteraction(event: PointerEvent) {
    if (pointers.current.delete(event.pointerId)) onInteraction(pointers.current.size > 0)
  }
  const hasInk = visibleStrokes(notebook.pages, selection ?? view).length > 0
  useImperativeHandle(ref, () => ({ flush: notebook.flush }))
  function run(action: NotebookAction) {
    try {
      const image = snapshot(notebook.pages, selection ?? view)
      setError('')
      onAction(selection ? 'Selected handwriting' : 'Visible handwriting', action, image)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not capture this handwriting.') }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 2, pages: notebook.pages }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'verso-ink-draft.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const conflict = notebook.pages.find(page => page.conflict)
  async function resolve(keep: boolean) {
    if (!conflict || !window.confirm(keep ? 'Replace the conflicting section of host ink with this tablet draft?' : 'Discard this conflicting tablet section and use the host’s ink? Download your ink first if you want to keep both.')) return
    setResolving(true)
    try { await notebook.resolve(conflict.id, keep) } finally { setResolving(false) }
  }
  return <section className="notebook panel ink-notebook" aria-label="Persistent ink notebook" hidden={hidden}
    onPointerDownCapture={event => {
      if ((event.target as Element).matches('.ink-live')) { pointers.current.add(event.pointerId); onInteraction(true) }
    }}
    onPointerUp={endInteraction} onPointerCancel={endInteraction} onLostPointerCapture={endInteraction}
    onKeyDown={event => {
      if (event.key === 'Escape') { setSelection(null); setTool('pen') }
      if (!disabled && !resolving && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); notebook.step(event.shiftKey)
      }
    }}>
    <div className="panel-heading notebook-heading">
      {viewSwitch}
      <div className="notebook-context-actions" role="group" aria-label="Ink notebook actions">
        {(Object.entries(NOTEBOOK_ACTIONS) as [NotebookAction, string][]).map(([action, label]) =>
          <button key={action} className="notebook-text-action" disabled={actionsDisabled || !visionVerified || !hasInk}
            title={`${label}: ${selection ? 'selected area' : 'visible handwriting'}`} aria-describedby="ink-action-scope" onClick={() => run(action)}>{label}</button>)}
        <button className="notebook-text-action" aria-label="Convert handwriting to Markdown"
          title={selection ? 'Convert selected handwriting and append to Text' : 'Convert all handwriting, including offscreen notes, and append to Text'}
          disabled={actionsDisabled || conversionDisabled || !visionVerified || !notebook.loaded || (selection ? !hasInk : !notebook.pages.some(page => page.strokes.length))}
          onClick={() => onConvert(notebook.pages, selection)}>{selection ? 'Convert' : 'Convert all'}</button>
      </div>
    </div>
    {conversionNotice}
    <div className="ink-tools" role="toolbar" aria-label="Ink tools">
      {(['pen', 'erase', 'select', 'move'] as InkTool[]).map(item => <button key={item} aria-pressed={tool === item}
        disabled={disabled || !notebook.loaded || resolving} onClick={() => { setTool(item); if (item !== 'select') setSelection(null) }}>
        {{ pen: 'Pen', erase: 'Eraser', select: 'Select', move: 'Move' }[item]}</button>)}
      <span className="notebook-action-divider">|</span>
      <button disabled={disabled || resolving || !notebook.canUndo} onClick={() => notebook.step(false)}>Undo</button>
      <button disabled={disabled || resolving || !notebook.canRedo} onClick={() => notebook.step(true)}>Redo</button>
    </div>
    <span id="ink-navigation-help" className="sr-only">Write with a pen. Two fingers pan and pinch to zoom. Move allows one-finger dragging. A mouse wheel or arrow keys pan; Ctrl plus wheel zooms. Home returns to your writing.</span>
    {!visionVerified && <p className="ink-help">Write freely. To ask about your handwriting, <button disabled={actionsDisabled} onClick={onSettings}>verify image support</button> in Model settings.</p>}
    {(error || notebook.error || conflict) && <div className="notice error" role="alert">
      <p>{error || notebook.error || 'This ink changed on another device. Your tablet draft is preserved.'}</p>
      <button onClick={download}>Download ink draft</button>{' '}
      {conflict ? <><button disabled={resolving} onClick={() => void resolve(true)}>Keep tablet ink</button>{' '}
        <button disabled={resolving} onClick={() => void resolve(false)}>Use host ink</button></>
        : <button onClick={() => { setError(''); void notebook.retry() }}>Retry</button>}
    </div>}
    <InkCanvas ref={surface} topic={topic} pages={notebook.pages} tool={tool} selected={selection} initialView={initialView}
      disabled={disabled || resolving || !notebook.loaded} onStroke={notebook.addStroke} onErase={notebook.erase}
      onSelect={setSelection} onView={setView} onError={setError} />
    <footer className="notebook-status" aria-label="Ink notebook status">
      <span role="status" className={notebook.localError ? 'save-error' : ''}>{notebook.status}</span>
      <button disabled={disabled || resolving || !notebook.loaded} onClick={() => surface.current?.returnToWriting()}>Return to writing</button>
      <button aria-label="Reset notebook zoom" title="Reset notebook zoom" disabled={disabled || resolving || !notebook.loaded}
        onClick={() => surface.current?.resetZoom()}>{Math.round(view.zoom * 100)}%</button>
      <span id="ink-action-scope" className="notebook-action-scope">{selection ? 'selection' : 'view'}</span>
    </footer>
  </section>
})
