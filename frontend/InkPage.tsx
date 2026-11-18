import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { inkId, drawStroke, eraserHits, rectangle, type InkPageData, type InkTool, type Point, type Rect, type Stroke } from './ink'

type Props = {
  page: InkPageData; number: number; tool: InkTool; selected: Rect | null; disabled: boolean
  onActivate: () => void; onEdit: (strokes: Stroke[]) => void; onSelect: (rect: Rect | null) => void
  onError: (error: string) => void
}
type Gesture = { pointer: number; tool: InkTool; stroke: Stroke; start: Point; last: Point; remaining: Stroke[]; limit: number }

export function InkPage({ page, number, tool, selected, disabled, onActivate, onEdit, onSelect, onError }: Props) {
  const base = useRef<HTMLCanvasElement>(null), live = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null), frame = useRef(0)
  const latest = useRef({ page, selected }); latest.current = { page, selected }
  function context(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(canvas.width / page.width, 0, 0, canvas.height / page.height, 0, 0)
    ctx.clearRect(0, 0, page.width, page.height)
    return ctx
  }
  function paint() {
    if (!base.current || !live.current) return
    const g = gesture.current
    const ctx = context(base.current)
    for (const stroke of g?.tool === 'erase' ? g.remaining : latest.current.page.strokes) drawStroke(ctx, stroke)
    paintLive()
  }
  function paintLive() {
    if (!live.current) return
    const ctx = context(live.current), g = gesture.current
    if (g?.tool === 'pen') drawStroke(ctx, g.stroke, '#f1f1f1', false)
    const rect = g?.tool === 'select' ? rectangle(g.start, g.last) : latest.current.selected
    if (rect) {
      ctx.strokeStyle = '#aaa'; ctx.fillStyle = '#ffffff0c'; ctx.lineWidth = 2
      ctx.setLineDash([8, 6]); ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
    }
  }
  function schedule() {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (gesture.current?.tool === 'erase') paint(); else paintLive()
    })
  }
  useLayoutEffect(() => {
    const canvas = base.current!
    const resize = () => {
      const width = canvas.getBoundingClientRect().width
      if (!width) return
      const ratio = Math.min(devicePixelRatio || 1, 3)
      for (const layer of [base.current!, live.current!]) {
        layer.width = Math.round(width * ratio)
        layer.height = Math.round(width * ratio * page.height / page.width)
      }
      paint()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas); resize()
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); gesture.current = null }
  }, [])
  useLayoutEffect(() => { paint() }, [page.strokes, selected])
  useLayoutEffect(() => { gesture.current = null; paint() }, [tool, disabled])
  function point(event: PointerEvent): Point {
    const box = live.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(page.width, (event.clientX - box.left) * page.width / box.width)),
      Math.max(0, Math.min(page.height, (event.clientY - box.top) * page.height / box.height)),
      event.pressure || gesture.current?.last[2] || .5]
  }
  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || tool === 'move' || gesture.current || event.pointerType === 'touch') return
    if (event.button !== 0 && event.button !== 5 && !(event.buttons & 32)) return
    event.preventDefault(); onActivate(); event.currentTarget.focus({ preventScroll: true })
    const currentTool = event.button === 5 || event.buttons & 32 ? 'erase' : tool
    const start = point(event.nativeEvent)
    const limit = Math.min(10_000, 200_000 - page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0))
    if (currentTool === 'pen' && (limit < 1 || page.strokes.length >= 5000)) {
      onError('This page is full. Add a page to keep writing.'); return
    }
    onSelect(null)
    gesture.current = { pointer: event.pointerId, tool: currentTool, start, last: start, limit,
      stroke: { id: inkId(), points: [start], size: 4 }, remaining: page.strokes }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic test events do not have capture. */ }
    if (currentTool === 'erase') gesture.current.remaining = page.strokes.filter(stroke => !eraserHits(stroke, start, start))
    schedule()
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    event.preventDefault()
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      const next = point(sample)
      if (g.tool === 'pen') {
        if (g.stroke.points.length >= g.limit) {
          finish(event); onError('Lift your pen to continue, or add a page if this page is full.'); return
        }
        if (Math.hypot(next[0] - g.last[0], next[1] - g.last[1]) > .25) g.stroke.points.push(next)
      }
      if (g.tool === 'erase') g.remaining = g.remaining.filter(stroke => !eraserHits(stroke, g.last, next))
      g.last = next
    }
    schedule()
  }
  function finish(event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    gesture.current = null
    if (!cancelled) {
      if (g.tool === 'pen') onEdit([...page.strokes, g.stroke])
      if (g.tool === 'erase' && g.remaining.length !== page.strokes.length) onEdit(g.remaining)
      if (g.tool === 'select') {
        const rect = rectangle(g.start, point(event.nativeEvent))
        onSelect(rect.width >= 2 && rect.height >= 2 ? rect : null)
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    paint()
  }
  return <div className="ink-sheet" data-page-id={page.id}>
    <canvas ref={base} className="ink-committed" aria-hidden="true" />
    <canvas ref={live} className={`ink-live ink-tool-${tool}`} aria-label={`Ink page ${number}`} tabIndex={0}
      aria-disabled={disabled} onFocus={onActivate} onPointerDown={down} onPointerMove={move}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)} onContextMenu={event => event.preventDefault()}>
      Handwritten page {number}. Use a pen or mouse to write; choose Move to scroll with touch.
    </canvas>
  </div>
}
