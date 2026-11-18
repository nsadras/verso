import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorMessage, streamMessage, type LatestTurn, type NotebookAction, type Settings as ModelSettings, type Topic } from './api'
import type { NotebookHandle } from './Notebook'
import { Notebook } from './NotebookWorkspace'
import { deleteDraft } from './inkDrafts'
import { Settings } from './Settings'
import { Diary, type DiaryHandle } from './Diary'
import { Workspace, type WorkspaceView } from './Workspace'

const ACTIVE_TOPIC_KEY = 'verso.active-topic'
const SIDEBAR_COLLAPSED_KEY = 'verso.sidebar-collapsed'

function savedPreference(key: string, legacyKey: string) {
  try { return localStorage.getItem(key) ?? localStorage.getItem(legacyKey) }
  catch { return null }
}

export default function App() {
  const [topics, setTopics] = useState<Topic[]>([]), [topic, setTopic] = useState<Topic | null>(null)
  const [settings, setSettings] = useState<ModelSettings | null>(null), [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [input, setInput] = useState(''), [question, setQuestion] = useState(''), [answer, setAnswer] = useState('')
  const [page, setPage] = useState(0)
  const [action, setAction] = useState<NotebookAction | null>(null)
  const [sharedImage, setSharedImage] = useState<string | undefined>()
  const [running, setRunning] = useState(false), [chatError, setChatError] = useState(''), [result, setResult] = useState('')
  const [omitted, setOmitted] = useState(0), [online, setOnline] = useState(navigator.onLine)
  const [view, setView] = useState<WorkspaceView>(() => matchMedia('(max-width: 760px)').matches ? 'chat' : 'split')
  const [renaming, setRenaming] = useState(false), [title, setTitle] = useState('')
  const [navigating, setNavigating] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    savedPreference(SIDEBAR_COLLAPSED_KEY, 'ephemeral.sidebar-collapsed') === 'true')
  const notebook = useRef<NotebookHandle>(null), controller = useRef<AbortController | null>(null)
  const generation = useRef('')
  const diary = useRef<DiaryHandle>(null)
  const sidebar = useRef<HTMLDialogElement>(null)

  async function initialize() {
    setLoading(true); setError('')
    try {
      const [list, config] = await Promise.all([api<Topic[]>('/topics'), api<ModelSettings>('/settings')])
      const savedTopic = savedPreference(ACTIVE_TOPIC_KEY, 'ephemeral.active-topic')
      const initial = list.find(item => item.id === savedTopic) ?? list[0] ?? await api<Topic>('/topics', 'POST', { title: 'New chat' })
      await openTopic(initial)
      setTopics(list.length ? list : [initial]); setSettings(config)
    } catch (err) { setError(errorMessage(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    void initialize()
    const onOnline = () => setOnline(true), onOffline = () => setOnline(false)
    const desktop = window.matchMedia('(min-width: 761px)')
    const onDesktop = () => {
      if (desktop.matches) { sidebar.current?.close(); setView(previous => previous === 'chat' ? 'split' : previous) }
    }
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
    desktop.addEventListener('change', onDesktop)
    return () => { controller.current?.abort(); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); desktop.removeEventListener('change', onDesktop) }
  }, [])
  useEffect(() => {
    if (topic) {
      try { localStorage.setItem(ACTIVE_TOPIC_KEY, topic.id) } catch { /* Opening chats still works without browser storage. */ }
    }
  }, [topic?.id])
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed)) }
    catch { /* The sidebar can still be toggled when browser storage is unavailable. */ }
  }, [sidebarCollapsed])

  function resetExchange(turn: LatestTurn | null = null) {
    setInput(''); setQuestion(turn?.user_text ?? ''); setAnswer(turn?.assistant_text ?? '')
    setAction(turn?.action ?? null)
    setSharedImage(turn?.image)
    setChatError(turn?.status === 'failed' ? 'The previous response did not finish. You can try your message again.' : '')
    setResult(turn?.status ?? ''); setOmitted(0); setPage(previous => previous + 1)
  }

  async function openTopic(next: Topic) {
    const turn = await api<LatestTurn | null>(`/topics/${next.id}/latest-turn`)
    // Commit the topic and its writing together, after a successful load.
    setTopic(next); resetExchange(turn); setRenaming(false)
  }

  async function flushNotes() {
    if (!notebook.current) return true
    if (await notebook.current.flush()) return true
    setError('Your notebook has unsaved changes. Resolve the save error or export your draft before switching topics.')
    setView('notes')
    return false
  }

  async function switchTopic(id: string) {
    if (id === topic?.id) { sidebar.current?.close(); return }
    const next = topics.find(item => item.id === id)
    if (!next) return
    setNavigating(true); setError('')
    try {
      if (await flushNotes()) await openTopic(next)
    }
    catch (err) { setError(errorMessage(err)) }
    finally { sidebar.current?.close(); setNavigating(false) }
  }

  async function newChat() {
    setNavigating(true); setError('')
    try {
      if (!await flushNotes()) { sidebar.current?.close(); return }
      const created = await api<Topic>('/topics', 'POST', { title: 'New chat' })
      setTopics(previous => [created, ...previous]); setTopic(created); resetExchange()
      setRenaming(false); sidebar.current?.close(); setView(matchMedia('(max-width: 760px)').matches ? 'chat' : 'split')
      diary.current?.focusDraft()
    } catch (err) { setError(errorMessage(err)); sidebar.current?.close() }
    finally { setNavigating(false) }
  }

  async function renameTopic(event: FormEvent) {
    event.preventDefault()
    if (!topic) return
    setNavigating(true); setError('')
    try {
      await api(`/topics/${topic.id}`, 'PATCH', { title })
      const renamed = { ...topic, title: title.trim() }
      setTopics(previous => previous.map(item => item.id === topic.id ? renamed : item)); setTopic(renamed)
      setRenaming(false)
    } catch (err) { setError(errorMessage(err)) }
    finally { setNavigating(false) }
  }

  async function deleteTopic() {
    if (!topic || !window.confirm(`Delete “${topic.title}”, its notebook, and all hidden conversation history? This cannot be undone.`)) return
    setNavigating(true); setError('')
    try {
      if (!await flushNotes()) { sidebar.current?.close(); return }
      await api(`/topics/${topic.id}`, 'DELETE')
      await deleteDraft(topic.id).catch(() => {})
      const remaining = topics.filter(item => item.id !== topic.id)
      setTopics(remaining); setTopic(null); resetExchange(); setRenaming(false)
      if (remaining.length) await openTopic(remaining[0])
      else {
        const created = await api<Topic>('/topics', 'POST', { title: 'New chat' })
        setTopics([created]); setTopic(created)
      }
      sidebar.current?.close()
    } catch (err) { setError(errorMessage(err)) }
    finally { setNavigating(false) }
  }

  async function send(content = input, notebookAction?: NotebookAction, image?: string) {
    if (loading || !topic || !content.trim() || controller.current || navigating) return
    const abort = new AbortController()
    controller.current = abort; generation.current = ''
    let submitted = false
    setRunning(true)
    if (notebookAction) setView('split')
    try {
      await diary.current?.advancePage(abort.signal, !!notebookAction)
      if (abort.signal.aborted) return
      setPage(previous => previous + 1)
      setQuestion(content); setAnswer(''); setAction(notebookAction ?? null)
      setSharedImage(image)
      if (!notebookAction) setInput('')
      setChatError(''); setResult(''); setOmitted(0)
      submitted = true
      await streamMessage(topic.id, content, abort.signal, event => {
        if (event.type === 'start') { generation.current = event.generation_id; setOmitted(event.omitted_turns) }
        if (event.type === 'delta') setAnswer(previous => previous + event.text)
        if (event.type === 'error') setChatError(event.message)
        if (event.type === 'done') setResult(event.status)
      }, notebookAction, image)
    } catch (err) {
      if (abort.signal.aborted) { if (submitted) setResult('cancelled') }
      else setChatError(errorMessage(err))
    } finally { setRunning(false); controller.current = null; generation.current = '' }
  }

  async function stop() {
    const id = generation.current
    controller.current?.abort()
    try { if (id) await api(`/generations/${id}/cancel`, 'POST') }
    catch { /* Aborting the connection also stops the backend stream. */ }
  }

  const sidebarContent = <>
    <button className="new-chat" disabled={running || navigating || loading || !settings} onClick={() => void newChat()}>+ New chat</button>
    <nav className="topic-list" aria-label="Topics">
      {topics.map(item => <div className={`topic-row${item.id === topic?.id ? ' selected' : ''}`} key={item.id}>
        <button className="topic-name" title={item.title} data-topic-id={item.id}
          aria-current={item.id === topic?.id ? 'page' : undefined}
          disabled={running || navigating} onClick={() => void switchTopic(item.id)}>{item.title}</button>
        {item.id === topic?.id && <div className="topic-actions">
          <button aria-label="Rename topic" title="Rename topic" disabled={running || navigating}
            onClick={() => { setTitle(item.title); setRenaming(true) }}>✎</button>
          <button aria-label="Delete topic" title="Delete topic" disabled={running || navigating} onClick={() => void deleteTopic()}>×</button>
        </div>}
      </div>)}
      {renaming && <form className="topic-form" onSubmit={renameTopic}>
        <label>Topic name<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div className="button-group"><button className="primary" disabled={navigating || running}>Save</button><button type="button" onClick={() => setRenaming(false)}>Cancel</button></div>
      </form>}
    </nav>
    <button className="settings-button" disabled={!settings || running} onClick={() => { sidebar.current?.close(); setShowSettings(true) }}>
      <span className="status-dot" />{settings?.mode === 'cloud' ? 'Hosted model' : 'Local model'}<span aria-hidden="true"> ⚙</span>
    </button>
  </>

  return <div className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${view === 'notes' ? ' is-notes-only' : ''}`}>
    <aside className="sidebar" aria-label="Topics">
      <button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed(previous => !previous)}
        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        aria-expanded={!sidebarCollapsed} aria-controls="desktop-topics">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
          <path d={sidebarCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
        </svg>
      </button>
      <div id="desktop-topics" className="sidebar-content" hidden={sidebarCollapsed}>{sidebarContent}</div>
    </aside>
    <dialog className="sidebar-dialog" ref={sidebar} aria-label="Topics">
      <button className="close-sidebar" aria-label="Close topics" onClick={() => sidebar.current?.close()}>×</button>
      {sidebarContent}
    </dialog>
    <div className="main-workspace">
      <div className="mobile-toolbar">
        <button aria-label="Open topics" onClick={() => sidebar.current?.showModal()}>☰ Topics</button>
        <nav className="mobile-tabs" aria-label="Workspace panel">
          <button aria-pressed={view === 'chat'} onClick={() => setView('chat')}>Chat</button>
          <button aria-pressed={view === 'notes'} onClick={() => setView('notes')}>Notebook</button>
          <button aria-pressed={view === 'split'} onClick={() => setView('split')}>Split</button>
        </nav>
      </div>

    {!online && <div className="notice page-notice" role="status">You’re offline. Ink drafts can be saved on this tablet; reconnect to sync or use a model. Keep this page open to retain unsaved text edits.</div>}
    {error && <div className="notice error page-notice" role="alert">{error} {!settings && <button onClick={() => void initialize()}>Reconnect</button>}<button className="dismiss" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        <Workspace view={view} conversation={<Diary ref={diary} page={page} input={input} question={question} answer={answer} action={action} image={sharedImage}
            running={running} disabled={loading || !topic || navigating} error={chatError} result={result} omitted={omitted}
            onInput={setInput} onSend={() => void send()} onStop={() => void stop()}
            onRetryAction={() => { if (action) void send(question, action, sharedImage) }} />}
          notebook={topic ? <Notebook key={topic.id} ref={notebook} topic={topic} navigating={navigating}
            expanded={view === 'notes'} onToggleExpanded={() => setView(previous => previous === 'notes' ? 'split' : 'notes')}
            actionsDisabled={loading || running || navigating || showSettings}
            visionVerified={settings?.vision_verified ?? false} onSettings={() => setShowSettings(true)}
            onAction={(selected, kind, image) => void send(selected, kind, image)} />
            : <section className="notebook panel" aria-label="Persistent notebook"><div className="panel-heading"><h2>Notebook</h2></div><textarea className="notebook-editor" aria-label="Notebook" disabled placeholder={loading ? 'Loading…' : 'Unable to load notebook.'} /></section>} />
    </div>
    {showSettings && settings && <Settings initial={settings} onSave={setSettings} onClose={() => setShowSettings(false)} />}
  </div>
}
