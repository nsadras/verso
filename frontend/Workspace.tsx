import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

export type WorkspaceView = 'split' | 'notes' | 'chat'
type Direction = 'horizontal' | 'vertical'
const RATIO_KEY = 'verso.workspace-ratios'
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
function readRatios(): Record<Direction, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(RATIO_KEY) ?? 'null')
    if (saved && [saved.horizontal, saved.vertical].every(value => Number.isFinite(value) && value >= .15 && value <= .85)) return saved
  } catch { /* Layout preferences must never prevent opening notes. */ }
  return { horizontal: .5, vertical: .5 }
}

export function Workspace({ view, conversation, notebook }: { view: WorkspaceView; conversation: ReactNode; notebook: ReactNode }) {
  const element = useRef<HTMLElement>(null), divider = useRef<HTMLDivElement>(null)
  const [direction, setDirection] = useState<Direction>(() => matchMedia('(orientation: portrait)').matches ? 'vertical' : 'horizontal')
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [ratios, setRatios] = useState(readRatios), [dragging, setDragging] = useState(false)
  const latestRatios = useRef(ratios); latestRatios.current = ratios
  const drag = useRef<{ pointer: number; offset: number } | null>(null)
  const vertical = direction === 'vertical', dividerSize = 16
  const available = Math.max(1, (vertical ? size.height : size.width) - dividerSize)
  const minimumChat = vertical ? 160 : 220, minimumNotes = vertical ? 240 : 340
  // Keep both panes usable. In a very small window the minimums shrink together.
  const fit = Math.min(1, available / (minimumChat + minimumNotes))
  const min = Math.max(.15, minimumChat * fit / available), max = Math.min(.85, 1 - minimumNotes * fit / available)
  const ratio = clamp(ratios[direction], min, max)
  function resize(value: number) { setRatios(previous => ({ ...previous, [direction]: clamp(value, min, max) })) }
  function save() {
    try { localStorage.setItem(RATIO_KEY, JSON.stringify(latestRatios.current)) } catch { /* Optional preference. */ }
  }
  function end(event?: PointerEvent<HTMLDivElement>) {
    if (event && drag.current?.pointer !== event.pointerId) return
    const pointer = drag.current?.pointer
    drag.current = null; setDragging(false); save()
    if (pointer !== undefined && divider.current?.hasPointerCapture(pointer)) divider.current.releasePointerCapture(pointer)
  }
  useLayoutEffect(() => {
    const node = element.current!
    const resize = () => { const box = node.getBoundingClientRect(); setSize({ width: box.width, height: box.height }) }
    const observer = new ResizeObserver(resize); observer.observe(node); resize()
    const portrait = matchMedia('(orientation: portrait)')
    const orient = () => setDirection(portrait.matches ? 'vertical' : 'horizontal')
    portrait.addEventListener('change', orient)
    return () => { observer.disconnect(); portrait.removeEventListener('change', orient) }
  }, [])
  useLayoutEffect(() => { end() }, [direction, view])
  useEffect(() => { const timer = setTimeout(save, 150); return () => clearTimeout(timer) }, [ratios])
  useEffect(() => {
    window.addEventListener('pagehide', save)
    return () => { window.removeEventListener('pagehide', save); save() }
  }, [])

  return <main ref={element} className={`workspace workspace-${view}${dragging ? ' is-resizing' : ''}`}
    data-direction={direction} style={{ '--chat-size': `${ratio}fr`, '--notes-size': `${1 - ratio}fr` } as CSSProperties}>
    <div className="conversation-pane" id="conversation-pane">{conversation}</div>
    <div ref={divider} className="workspace-divider" role="separator" tabIndex={0} hidden={view !== 'split'}
      aria-label="Resize conversation and notebook" aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-controls="conversation-pane notebook-pane" aria-valuemin={Math.round(min * 100)} aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(ratio * 100)} aria-valuetext={`${Math.round(ratio * 100)}% conversation, ${Math.round((1 - ratio) * 100)}% notebook`}
      title="Drag to resize · Double-click to balance" onDoubleClick={() => resize(.5)}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true })
        const box = event.currentTarget.getBoundingClientRect()
        drag.current = { pointer: event.pointerId, offset: vertical ? event.clientY - box.top - box.height / 2 : event.clientX - box.left - box.width / 2 }
        setDragging(true)
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic test events have no capture. */ }
      }}
      onPointerMove={event => {
        const active = drag.current
        if (!active || active.pointer !== event.pointerId) return
        event.preventDefault()
        const box = element.current!.getBoundingClientRect()
        const position = vertical ? event.clientY - box.top : event.clientX - box.left
        resize((position - active.offset - dividerSize / 2) / available)
      }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={event => {
        const decrease = vertical ? 'ArrowUp' : 'ArrowLeft', increase = vertical ? 'ArrowDown' : 'ArrowRight'
        if (![decrease, increase, 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        resize(event.key === 'Home' ? min : event.key === 'End' ? max : event.key === 'Enter' ? .5
          : ratio + (event.key === increase ? 1 : -1) * (event.shiftKey ? .1 : .02))
      }} />
    <div className="notebook-pane" id="notebook-pane">{notebook}</div>
  </main>
}
