import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Notebook as TextNotebook, type NotebookHandle } from './Notebook'
import { InkNotebook } from './InkNotebook'
import type { NotebookAction, Topic } from './api'

type Props = {
  topic: Topic; navigating: boolean; actionsDisabled: boolean; visionVerified: boolean
  expanded: boolean; onToggleExpanded: () => void
  onSettings: () => void; onAction: (text: string, action: NotebookAction, image?: string) => void
}
export const Notebook = forwardRef<NotebookHandle, Props>(function Notebook({ topic, navigating, actionsDisabled, visionVerified, expanded, onToggleExpanded, onSettings, onAction }, ref) {
  const [view, setView] = useState(() => { try { return localStorage.getItem('verso.notebook-view') === 'ink' ? 'ink' : 'text' } catch { return 'text' } })
  const [opened, setOpened] = useState(view === 'ink')
  const text = useRef<NotebookHandle>(null), ink = useRef<NotebookHandle>(null)
  useImperativeHandle(ref, () => ({ flush: async () => {
    const savedText = await text.current?.flush() ?? true
    const savedInk = await ink.current?.flush() ?? true
    return savedText && savedInk
  } }))
  const viewSwitch = <div className="notebook-views" role="group" aria-label="Notebook view">
    <button type="button" className="notebook-layout-toggle" onClick={onToggleExpanded}
      aria-label={expanded ? 'Show split view' : 'Expand notebook'} title={expanded ? 'Show split view' : 'Expand notebook'}
      aria-expanded={expanded} aria-controls="notebook-pane">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {expanded ? <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" /></>
          : <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><path d="m3 3 6 6m12-6-6 6M3 21l6-6m12 6-6-6" /></>}
      </svg>
    </button>
    {['text', 'ink'].map(name => <button key={name} className="notebook-text-action" disabled={navigating} aria-pressed={view === name}
      onClick={() => { setView(name); if (name === 'ink') setOpened(true); try { localStorage.setItem('verso.notebook-view', name) } catch { /* Optional preference. */ } }}>
      {name === 'text' ? 'Text' : 'Ink'}</button>)}
  </div>
  return <>
    <TextNotebook ref={text} topic={topic} navigating={navigating} actionsDisabled={actionsDisabled || view !== 'text'}
      onAction={onAction} hidden={view !== 'text'} viewSwitch={viewSwitch} />
    {opened && <InkNotebook ref={ink} topic={topic.id} hidden={view !== 'ink'} viewSwitch={viewSwitch} disabled={navigating}
      actionsDisabled={actionsDisabled || view !== 'ink'} visionVerified={visionVerified} onSettings={onSettings} onAction={onAction} />}
  </>
})
