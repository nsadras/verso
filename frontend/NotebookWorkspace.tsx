import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Notebook as TextNotebook, type NotebookHandle } from './Notebook'
import { InkNotebook } from './InkNotebook'
import type { NotebookAction, Topic } from './api'

type Props = {
  topic: Topic; navigating: boolean; actionsDisabled: boolean; visionVerified: boolean
  onSettings: () => void; onAction: (text: string, action: NotebookAction, image?: string) => void
}
export const Notebook = forwardRef<NotebookHandle, Props>(function Notebook({ topic, navigating, actionsDisabled, visionVerified, onSettings, onAction }, ref) {
  const [view, setView] = useState(() => { try { return localStorage.getItem('verso.notebook-view') === 'ink' ? 'ink' : 'text' } catch { return 'text' } })
  const [opened, setOpened] = useState(view === 'ink')
  const text = useRef<NotebookHandle>(null), ink = useRef<NotebookHandle>(null)
  useImperativeHandle(ref, () => ({ flush: async () => {
    const savedText = await text.current?.flush() ?? true
    const savedInk = await ink.current?.flush() ?? true
    return savedText && savedInk
  } }))
  const viewSwitch = <div className="notebook-views" role="group" aria-label="Notebook view">
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
