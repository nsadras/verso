import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { api, ApiError, downloadMarkdown, errorMessage, type NotebookData, type Topic } from './api'

export type NotebookHandle = { flush: () => Promise<boolean> }

export const Notebook = forwardRef<NotebookHandle, { topic: Topic; navigating: boolean }>(function Notebook({ topic, navigating }, ref) {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const current = useRef(''), saved = useRef(''), revision = useRef(0)
  const ready = useRef(false), alive = useRef(true)
  const blocked = useRef(false)
  const inFlight = useRef<Promise<boolean> | null>(null)

  async function load() {
    try {
      const notebook = await api<NotebookData>(`/topics/${topic.id}/notebook`)
      if (!alive.current) return
      current.current = saved.current = notebook.markdown
      revision.current = notebook.revision
      ready.current = true
      blocked.current = false
      setText(notebook.markdown); setLoaded(true); setConflict(false); setError(''); setStatus('Saved on host')
    } catch (err) { if (alive.current) { setError(errorMessage(err)); setStatus('Unavailable') } }
  }

  async function flush(): Promise<boolean> {
    if (!ready.current) return false
    if (blocked.current) return false
    if (inFlight.current) return inFlight.current
    const operation = async () => {
      try {
        while (current.current !== saved.current) {
          const snapshot = current.current
          if (alive.current) { setStatus('Saving…'); setError('') }
          const result = await api<{ revision: number }>(`/topics/${topic.id}/notebook`, 'PUT', {
            markdown: snapshot, revision: revision.current,
          })
          saved.current = snapshot
          revision.current = result.revision
        }
        if (alive.current) setStatus('Saved on host')
        return true
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) blocked.current = true
        if (alive.current) {
          setConflict(blocked.current); setError(errorMessage(err)); setStatus('Not saved')
        }
        return false
      } finally { inFlight.current = null }
    }
    // No operation is needed when clean (also avoids a synchronously resolved ref).
    if (current.current === saved.current) return true
    inFlight.current = operation()
    return inFlight.current
  }

  useImperativeHandle(ref, () => ({ flush }))
  useEffect(() => {
    alive.current = true
    void load()
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.current !== saved.current) { event.preventDefault(); event.returnValue = '' }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush() }
    const onOnline = () => { void flush() }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive.current = false
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [topic.id])

  useEffect(() => {
    if (!loaded || current.current === saved.current) return
    const timer = setTimeout(() => { void flush() }, 500)
    return () => clearTimeout(timer)
  }, [text, loaded])

  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return <section className="notebook panel" aria-label="Persistent notebook">
    <div className="panel-heading">
      <div className="notebook-summary">
        <h2>Notebook</h2>
        <div className="notebook-meta">
          <span className={error ? 'save-error' : ''} role="status">{status === 'Saved on host' ? '✓ ' : ''}{status}</span>
          <span>{words} {words === 1 ? 'word' : 'words'}</span>
        </div>
      </div>
      <div className="button-group notebook-actions">
        <button disabled={!loaded} onClick={() => setPreview(!preview)} aria-pressed={preview} title={preview ? 'Edit Markdown' : 'Preview Markdown'}>{preview ? 'Edit' : 'Preview'}</button>
        <button disabled={!loaded} onClick={() => downloadMarkdown(topic.title, current.current)}>Export .md</button>
      </div>
    </div>
    {error && <div className="notice error" role="alert">
      <p>{error}</p>
      {conflict ? <>
        <button onClick={() => downloadMarkdown(`${topic.title}-draft`, current.current)}>Export my draft</button>{' '}
        <button onClick={() => { if (window.confirm('Replace the editor with the saved notebook? Export your draft first if you want to keep it.')) void load() }}>Reload saved version</button>
      </> : <button onClick={() => { if (loaded) void flush(); else void load() }}>Retry {loaded ? 'save' : 'loading'}</button>}
    </div>}
    {preview ? <div className="markdown notebook-preview"><Markdown>{text || '*Your notebook is empty.*'}</Markdown></div>
      : <textarea className="notebook-editor" aria-label="Notebook" spellCheck disabled={!loaded || navigating}
          value={text} placeholder="Write your notes…"
          onChange={event => { current.current = event.target.value; setText(event.target.value); setStatus('Unsaved changes') }} />}
  </section>
})
