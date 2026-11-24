import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Notebook as TextNotebook, type NotebookHandle, type TextNotebookHandle } from './Notebook'
import { InkNotebook } from './InkNotebook'
import { downloadMarkdown, type NotebookAction, type Topic } from './api'
import { useInkConversion } from './useInkConversion'

type Props = {
  topic: Topic; navigating: boolean; actionsDisabled: boolean; visionVerified: boolean
  expanded: boolean; onToggleExpanded: () => void
  onConversionBusyChange: (busy: boolean) => void
  onSettings: () => void; onAction: (text: string, action: NotebookAction, image?: string) => void
}
export const Notebook = forwardRef<NotebookHandle, Props>(function Notebook({ topic, navigating, actionsDisabled, visionVerified, expanded, onToggleExpanded, onSettings, onAction, onConversionBusyChange }, ref) {
  const [view, setView] = useState(() => { try { return localStorage.getItem('verso.notebook-view') === 'ink' ? 'ink' : 'text' } catch { return 'text' } })
  const [opened, setOpened] = useState(view === 'ink')
  const text = useRef<TextNotebookHandle>(null), ink = useRef<NotebookHandle>(null)
  const interacting = useRef(false), endInteraction = useRef<(() => void) | null>(null)
  function releaseReveal() { const finish = endInteraction.current; endInteraction.current = null; finish?.() }
  function changeView(name: string) {
    if (name === 'text') releaseReveal()
    setView(name); if (name === 'ink') setOpened(true)
    try { localStorage.setItem('verso.notebook-view', name) } catch { /* Optional preference. */ }
  }
  const conversion = useInkConversion(topic.id, async draft => {
    if (!text.current) throw new Error('The text notebook is still loading. Retry in a moment.')
    await text.current.appendConversion(draft)
    // Keep the progress row and canvas geometry stable until the pen/touch gesture
    // finishes. Hiding the canvas mid-stroke would cancel that unfinished writing.
    if (interacting.current) await new Promise<void>(resolve => { endInteraction.current = resolve })
    changeView('text')
  }, onConversionBusyChange)
  useImperativeHandle(ref, () => ({ flush: async () => {
    if (!conversion.canLeave()) return false
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
      onClick={() => changeView(name)}>
      {name === 'text' ? 'Text' : 'Ink'}</button>)}
  </div>
  const conversionNotice = (conversion.busy || conversion.pending || conversion.error) && <div className={`conversion-status${conversion.busy ? ' is-converting' : ''}`} aria-label="Handwriting conversion">
    {conversion.busy ? <><span role="status" title={conversion.progress}>{conversion.progress || 'Preparing conversion…'}</span>
      <button disabled={!conversion.cancellable} aria-hidden={!conversion.cancellable} style={{ visibility: conversion.cancellable ? 'visible' : 'hidden' }}
        onClick={conversion.cancel}>Cancel conversion</button></>
      : <>
        {conversion.error && <span role="alert">{conversion.error}</span>}
        {conversion.pending ? <>
          <span role="status">Converted text is ready to append.{!conversion.locallySaved && ' Keep this page open or download it; tablet storage is unavailable.'}</span>
          <button disabled={actionsDisabled} onClick={() => void conversion.retry()}>Retry append</button>
          <button onClick={() => downloadMarkdown(`${topic.title}-converted`, conversion.pending!.markdown)}>Download Markdown</button>
          <button onClick={() => void conversion.discard()}>Discard conversion</button>
        </> : !conversion.ready ? <button onClick={() => void conversion.recover()}>Retry recovery</button>
          : <button onClick={conversion.dismiss}>Dismiss</button>}
      </>}
  </div>
  return <>
    <TextNotebook ref={text} topic={topic} navigating={navigating} actionsDisabled={actionsDisabled || view !== 'text'}
      onAction={onAction} hidden={view !== 'text'} viewSwitch={viewSwitch} conversionNotice={conversionNotice} />
    {opened && <InkNotebook ref={ink} topic={topic.id} hidden={view !== 'ink'} viewSwitch={viewSwitch} disabled={navigating}
      actionsDisabled={actionsDisabled || view !== 'ink'} visionVerified={visionVerified} onSettings={onSettings} onAction={onAction}
      conversionNotice={conversionNotice} conversionDisabled={!conversion.ready || conversion.busy || !!conversion.pending}
      onConvert={(pages, selected) => void conversion.convert(pages, selected)}
      onInteraction={active => {
        interacting.current = active
        if (!active) releaseReveal()
      }} />}
  </>
})
