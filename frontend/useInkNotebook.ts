import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from './api'
import { inkId, newInkPage, PAGE_HEIGHT, PAGE_WIDTH, type InkPageData, type Point, type Stroke } from './ink'
import { readDraft, writeDraft, type DraftPage } from './inkDrafts'

type Change = { id: string; before: Stroke[]; after: Stroke[] }
function continuous(page: DraftPage, index: number): DraftPage {
  if (page.space === 'canvas') return page
  // Upgrade only the current draft. An older in-flight request remains byte-for-
  // byte retryable, then the converted draft follows using its acknowledged revision.
  return { ...page, space: 'canvas', dirty: true, mutation_id: inkId(),
    strokes: page.strokes.map(stroke => ({ ...stroke,
      points: stroke.points.map(([x, y, pressure]): Point => [x, y + index * PAGE_HEIGHT, pressure]) })) }
}

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
  const undo = useRef<{ past: Change[][]; future: Change[][] }>({ past: [], future: [] })
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
            space: page.space, strokes: page.strokes, revision: page.revision, mutation_id: page.mutation_id }
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
      records.current = records.current.map(continuous)
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

  function edit(changes: Change[], remember = true) {
    if (!changes.length) return
    if (remember) {
      undo.current.past.push(changes); undo.current.past = undo.current.past.slice(-50); undo.current.future = []
    }
    const changed = new Map(changes.map(change => [change.id, change.after]))
    records.current = records.current.map(page => changed.has(page.id)
      ? { ...page, strokes: changed.get(page.id)!, dirty: true, mutation_id: inkId() } : page)
    publish()
    setEdited(value => value + 1)
    void persist()
  }
  function step(redo: boolean) {
    const changes = (redo ? undo.current.future : undo.current.past).pop()
    if (!changes) return
    ;(redo ? undo.current.past : undo.current.future).push(changes)
    edit(changes.map(change => ({ ...change, after: redo ? change.after : change.before })), false)
  }
  function addStroke(stroke: Stroke) {
    const cell = ([x, y]: Point) => `${Math.floor(x / PAGE_WIDTH)},${Math.floor(y / PAGE_HEIGHT)}`
    const destination = cell(stroke.points[0])
    // Sections bound routine saves; strokes can cross section boundaries intact.
    let page = records.current.find(item => !item.conflict && item.strokes.length < 500
      && (!item.strokes.length || cell(item.strokes[0].points[0]) === destination)
      && item.strokes.reduce((n, s) => n + s.points.length, 0) + stroke.points.length <= 20_000)
    if (!page) {
      page = { ...newInkPage(), dirty: true }
      records.current = [...records.current, page]
    }
    edit([{ id: page.id, before: page.strokes, after: [...page.strokes, stroke] }])
  }
  function erase(ids: Set<string>) {
    const changes = records.current.flatMap(page => {
      const after = page.strokes.filter(stroke => !ids.has(stroke.id))
      return after.length === page.strokes.length ? [] : [{ id: page.id, before: page.strokes, after }]
    })
    edit(changes)
  }
  async function resolve(id: string, keepLocal: boolean) {
    await inFlight.current
    try {
      const remote = await api<InkPageData[]>(`/topics/${topic}/ink-pages`)
      const saved = remote.find(page => page.id === id)
      if (!saved) throw new Error('The saved page is missing. Download your ink before reloading.')
      replace(id, item => keepLocal ? { ...item, revision: saved.revision, pending: undefined, conflict: false, dirty: true, mutation_id: inkId() }
        : continuous({ ...saved, dirty: false }, remote.findIndex(page => page.id === id)))
      undo.current = { past: [], future: [] }
      await persist(); await sync()
    } catch (error) { if (alive.current) setHostError(errorMessage(error)) }
  }
  async function flush() {
    await sync(); await localQueue.current
    return !records.current.some(page => page.dirty) || localSafe.current
  }
  const dirty = pages.some(page => page.dirty)
  return { pages, loaded, addStroke, erase, step, canUndo: !!undo.current.past.length, canRedo: !!undo.current.future.length,
    resolve, flush, retry: () => loaded ? sync() : load(),
    error: localError || hostError, localError,
    status: !loaded ? 'Loading…' : localBusy ? 'Saving on tablet…' : localError && dirty ? 'Not saved' : dirty ? 'Saved on tablet' : 'Saved on host' }
}
