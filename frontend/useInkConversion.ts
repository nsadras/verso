import { useEffect, useRef, useState } from 'react'
import { errorMessage, transcribeInk, type ConversionDraft } from './api'
import { EmptyInkError, inkId, snapshot, type InkPageData, type Rect } from './ink'
import { conversionAreas } from './inkConversion'
import { readConversion, saveConversion } from './inkDrafts'

export function useInkConversion(topic: string, append: (draft: ConversionDraft) => Promise<void>, onBusy: (busy: boolean) => void) {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(''), [error, setError] = useState('')
  const [pending, setPending] = useState<ConversionDraft>()
  const callbacks = useRef({ append, onBusy }); callbacks.current = { append, onBusy }
  const alive = useRef(true), active = useRef(false), safe = useRef(true)
  const draft = useRef<ConversionDraft | undefined>(undefined)
  const controller = useRef<AbortController | null>(null)
  const [cancellable, setCancellable] = useState(false)

  async function recover() {
    try {
      const saved = await readConversion(topic)
      if (!alive.current) return
      draft.current = saved; safe.current = true
      setPending(saved); setReady(true); setError('')
    } catch (err) { if (alive.current) setError(`Could not check for a saved conversion. ${errorMessage(err)}`) }
  }
  useEffect(() => {
    alive.current = true
    void recover()
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (active.current || (draft.current && !safe.current)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      alive.current = false; controller.current?.abort(); callbacks.current.onBusy(false)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [topic])

  function start() {
    active.current = true; setBusy(true); setError(''); callbacks.current.onBusy(true)
  }
  function finish() {
    active.current = false; controller.current = null
    if (alive.current) { setBusy(false); setCancellable(false); setProgress(''); callbacks.current.onBusy(false) }
  }
  async function appendDraft(value: ConversionDraft) {
    setCancellable(false); setProgress('Appending to Text…')
    await callbacks.current.append(value)
    // The host has a durable copy now. A stale local recovery record is harmless:
    // the append receipt prevents a second insertion even after a lost response.
    safe.current = true
    await saveConversion(topic).catch(() => {})
    draft.current = undefined
    if (alive.current) setPending(undefined)
  }
  async function convert(pages: InkPageData[], selection: Rect | null) {
    if (active.current || draft.current || !ready) return
    start()
    const abort = new AbortController(); controller.current = abort; setCancellable(true)
    try {
      // Completed strokes are immutable; holding this array captures the click-time
      // source while the user continues writing. Render only one image at a time.
      const areas = conversionAreas(pages, selection), parts: string[] = []
      let length = 0
      for (const [index, area] of areas.entries()) {
        abort.signal.throwIfAborted()
        setProgress(`Converting ${selection ? 'selection' : 'notebook'} · section ${index + 1}/${areas.length}`)
        let image: string
        try { image = snapshot(pages, area) }
        catch (err) { if (err instanceof EmptyInkError) continue; throw err }
        const markdown = await transcribeInk(topic, image, abort.signal)
        length += markdown.length + (parts.length ? 2 : 0)
        if (length > 500_000) throw new Error('The conversion is too long. Select a smaller part of the notebook.')
        parts.push(markdown)
      }
      abort.signal.throwIfAborted()
      if (!parts.length) throw new Error('There is no handwriting inside this selection.')
      const value: ConversionDraft = { id: inkId(), scope: selection ? 'selection' : 'notebook', markdown: parts.join('\n\n') }
      // From this point onward, keep the complete result until it is appended or
      // explicitly discarded. Cancelling a partial transcription never appends it.
      setCancellable(false); controller.current = null; draft.current = value; safe.current = false; setPending(value)
      try { await saveConversion(topic, value); safe.current = true } catch { /* Still attempt a durable host save. */ }
      if (alive.current) await appendDraft(value)
    } catch (err) {
      if (alive.current && !abort.signal.aborted) setError(errorMessage(err))
    } finally { finish() }
  }
  async function retry() {
    if (active.current || !draft.current) return
    start()
    try { await appendDraft(draft.current) }
    catch (err) { if (alive.current) setError(errorMessage(err)) }
    finally { finish() }
  }
  async function discard() {
    if (active.current || !window.confirm('Discard this converted text? Your handwriting and saved text will stay as they are.')) return
    try {
      await saveConversion(topic)
      draft.current = undefined; safe.current = true; setPending(undefined); setError('')
    } catch (err) { setError(errorMessage(err)) }
  }
  return { ready, busy, progress, error, pending, cancellable, convert, retry, discard, recover,
    cancel: () => controller.current?.abort(), dismiss: () => setError(''),
    canLeave: () => !active.current && (!draft.current || safe.current),
    locallySaved: safe.current }
}
