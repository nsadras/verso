import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from './api'
import { inkId, newInkPage, type InkPageData, type Stroke } from './ink'
import { readDraft, writeDraft, type DraftPage } from './inkDrafts'

export function useInkNotebook(topic: string) {
  const [pages, setPages] = useState<DraftPage[]>([])
  const [loaded, setLoaded] = useState(false), [localBusy, setLocalBusy] = useState(false)
  const [edited, setEdited] = useState(0)
  const [localError, setLocalError] = useState(''), [hostError, setHostError] = useState('')
  const records = useRef<DraftPage[]>([]), alive = useRef(true), ready = useRef(false)
  const loading = useRef(false)
  const localQueue = useRef(Promise.resolve(true)), pendingLocal = useRef(0), localSafe = useRef(false)
  const persisted = useRef(new Map<string, DraftPage>())
  const inFlight = useRef<Promise<void> | null>(null)
  const undo = useRef(new Map<string, { past: Stroke[][]; future: Stroke[][] }>())
  const publish = () => { if (alive.current) setPages([...records.current]) }
  const replace = (id: string, change: (page: DraftPage) => DraftPage) => {
    records.current = records.current.map(page => page.id === id ? change(page) : page)
    publish()
  }
  function persist() {
    const changes = records.current.map((page, index) => ({ page, index }))
      .filter(({ page }) => persisted.current.get(page.id) !== page)
    const snapshot = structuredClone(changes)
    const version = ++pendingLocal.current
    localSafe.current = false
    if (alive.current) setLocalBusy(true)
    localQueue.current = localQueue.current.then(async () => {
      try {
        await writeDraft(topic, snapshot)
        for (const { page } of changes) persisted.current.set(page.id, page)
        if (version === pendingLocal.current) {
          localSafe.current = true
          if (alive.current) setLocalError('')
        }
        return true
      } catch {
        if (alive.current) setLocalError('Could not save a recovery draft on this tablet. Keep this page open until saved on host, or download your ink.')
        return false
      } finally { if (alive.current && version === pendingLocal.current) setLocalBusy(false) }
    })
    return localQueue.current
  }
  async function sync() {
    if (!ready.current) return
    if (inFlight.current) return inFlight.current
    const operation = async () => {
      try {
        while (true) {
          const page = records.current.find(item => item.dirty && !item.conflict)
          if (!page) break
          const pending = page.pending ?? { id: page.id, width: page.width, height: page.height,
            strokes: page.strokes, revision: page.revision, mutation_id: page.mutation_id }
          replace(page.id, item => ({ ...item, pending }))
          await persist()
          try {
            const result = await api<{ revision: number }>(`/topics/${topic}/ink-pages/${page.id}`, 'PUT', pending, AbortSignal.timeout(12_000))
            replace(page.id, item => ({ ...item, revision: result.revision, pending: undefined,
              dirty: item.mutation_id !== pending.mutation_id }))
            await persist()
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              replace(page.id, item => ({ ...item, conflict: true }))
              await persist()
            }
            throw error
          }
        }
        if (alive.current) setHostError('')
      } catch (error) { if (alive.current) setHostError(errorMessage(error)) }
      finally { inFlight.current = null }
    }
    // Defer execution so even an empty operation clears the ref after assignment.
    inFlight.current = Promise.resolve().then(operation)
    return inFlight.current
  }
  async function load() {
    if (loading.current) return
    loading.current = true
    try {
      let local: DraftPage[] = []
      try { local = await readDraft(topic) } catch { /* Host remains usable without IndexedDB. */ }
      try {
        const remote = await api<InkPageData[]>(`/topics/${topic}/ink-pages`, 'GET', undefined, AbortSignal.timeout(12_000))
        if (!alive.current) return
        const remaining = new Map(local.map(item => [item.id, item]))
        records.current = remote.map(page => {
          const draft = remaining.get(page.id); remaining.delete(page.id)
          if (!draft?.dirty) return { ...page, dirty: false }
          if (draft.pending?.mutation_id === page.mutation_id) {
            return { ...draft, revision: page.revision, pending: undefined, conflict: false, dirty: draft.mutation_id !== page.mutation_id }
          }
          return { ...draft, conflict: draft.revision !== page.revision }
        })
        records.current.push(...[...remaining.values()].filter(page => page.dirty))
        setHostError('')
      } catch (error) {
        if (!alive.current) return
        setHostError(errorMessage(error))
        // A deleted topic must never be recreated from its recovery draft.
        if (error instanceof ApiError && error.status === 404) return
        if (!local.length) return
        records.current = local
      }
      if (!records.current.length) records.current = [{ ...newInkPage(), dirty: true }]
      ready.current = true; setLoaded(true); publish()
      await persist(); void sync()
    } finally { loading.current = false }
  }
  useEffect(() => {
    alive.current = true
    void load()
    const retry = () => { if (ready.current) void sync() }
    const unload = (event: BeforeUnloadEvent) => {
      if (!localSafe.current && records.current.some(page => page.dirty)) { event.preventDefault(); event.returnValue = '' }
    }
    const timer = setInterval(retry, 10_000)
    window.addEventListener('online', retry); window.addEventListener('beforeunload', unload)
    document.addEventListener('visibilitychange', retry)
    return () => {
      alive.current = false; clearInterval(timer)
      window.removeEventListener('online', retry); window.removeEventListener('beforeunload', unload)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [topic])
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => { void sync() }, 500)
    return () => clearTimeout(timer)
  }, [edited, loaded])

  function history(id: string) {
    if (!undo.current.has(id)) undo.current.set(id, { past: [], future: [] })
    return undo.current.get(id)!
  }
  function edit(id: string, strokes: Stroke[], remember = true) {
    const page = records.current.find(item => item.id === id)!
    if (remember) {
      const stack = history(id)
      stack.past.push(page.strokes); stack.past = stack.past.slice(-50); stack.future = []
    }
    replace(id, item => ({ ...item, strokes, dirty: true, mutation_id: inkId() }))
    setEdited(value => value + 1)
    void persist()
  }
  function step(id: string, redo: boolean) {
    const page = records.current.find(item => item.id === id)!, stack = history(id)
    const strokes = (redo ? stack.future : stack.past).pop()
    if (!strokes) return
    ;(redo ? stack.past : stack.future).push(page.strokes)
    edit(id, strokes, false)
  }
  function add() {
    const page = { ...newInkPage(), dirty: true }
    records.current = [...records.current, page]; publish(); void persist()
    setEdited(value => value + 1)
    return page.id
  }
  async function resolve(id: string, keepLocal: boolean) {
    await inFlight.current
    try {
      const remote = await api<InkPageData[]>(`/topics/${topic}/ink-pages`)
      const saved = remote.find(page => page.id === id)
      if (!saved) throw new Error('The saved page is missing. Download your ink before reloading.')
      replace(id, item => keepLocal ? { ...item, revision: saved.revision, pending: undefined, conflict: false, dirty: true, mutation_id: inkId() }
        : { ...saved, dirty: false })
      undo.current.delete(id)
      await persist(); await sync()
    } catch (error) { if (alive.current) setHostError(errorMessage(error)) }
  }
  async function flush() {
    await sync(); await localQueue.current
    return !records.current.some(page => page.dirty) || localSafe.current
  }
  const dirty = pages.some(page => page.dirty)
  return { pages, loaded, edit, step, history, add, resolve, flush, retry: () => loaded ? sync() : load(),
    error: localError || hostError, localError,
    status: !loaded ? 'Loading…' : localBusy ? 'Saving on tablet…' : localError && dirty ? 'Not saved' : dirty ? 'Saved on tablet' : 'Saved on host' }
}
