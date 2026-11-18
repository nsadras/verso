import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { inkId, drawStroke, eraserHits, rectangle, visibleStrokes, strokeBounds, PAGE_WIDTH, WORLD_LIMIT, MIN_ZOOM, MAX_ZOOM,
  type Camera, type InkView, type InkPageData, type InkTool, type Point, type Rect, type Stroke } from './ink'

type Props = {
  topic: string; pages: InkPageData[]; tool: InkTool; selected: Rect | null; disabled: boolean; initialView: Camera
  onStroke: (stroke: Stroke) => void; onErase: (ids: Set<string>) => void; onSelect: (rect: Rect | null) => void
  onView: (view: InkView) => void; onError: (error: string) => void
}
export type InkCanvasHandle = { returnToWriting: () => void; resetZoom: () => void }
type Gesture = { pointer: number; tool: InkTool; stroke: Stroke; start: Point; last: Point; erased: Set<string> }
type Position = { x: number; y: number }
type Navigation = { anchor: Position; distance: number; zoom: number }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export const InkCanvas = forwardRef<InkCanvasHandle, Props>(function InkCanvas(props, ref) {
  const sheet = useRef<HTMLDivElement>(null), base = useRef<HTMLCanvasElement>(null), live = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props); latest.current = props
  const camera = useRef<Camera>({ ...props.initialView })
  const size = useRef({ width: 0, height: 0, ratio: 1 })
  const gesture = useRef<Gesture | null>(null), touches = useRef(new Map<number, Position>())
  const navigation = useRef<Navigation | null>(null), mouse = useRef<number | null>(null)
  const frame = useRef(0), repaint = useRef(false), report = useRef(false), saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scale = () => size.current.width / PAGE_WIDTH * camera.current.zoom
  const area = (): Rect => ({ x: camera.current.x, y: camera.current.y,
    width: size.current.width / scale(), height: size.current.height / scale() })
  const world = (p: Position): Position => ({ x: camera.current.x + p.x / scale(), y: camera.current.y + p.y / scale() })
  function saveView() {
    clearTimeout(saveTimer.current)
    try { localStorage.setItem(`verso.ink-view.${latest.current.topic}`, JSON.stringify(camera.current)) } catch { /* Optional view preference. */ }
  }
  function context(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height)
    const factor = scale() * size.current.ratio
    ctx.setTransform(factor, 0, 0, factor, -camera.current.x * factor, -camera.current.y * factor)
    return ctx
  }
  function paintLive() {
    if (!size.current.width || !live.current) return
    const ctx = context(live.current), g = gesture.current
    if (g?.tool === 'pen') drawStroke(ctx, g.stroke, '#f1f1f1', false)
    const rect = g?.tool === 'select' ? rectangle(g.start, g.last) : latest.current.selected
    if (rect) {
      ctx.strokeStyle = '#aaa'; ctx.fillStyle = '#ffffff0c'; ctx.lineWidth = 1 / scale()
      ctx.setLineDash([5 / scale(), 4 / scale()]); ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
    }
  }
  function paint() {
    if (!size.current.width || !base.current) return
    const ctx = context(base.current), erased = gesture.current?.erased
    for (const stroke of visibleStrokes(latest.current.pages, area())) {
      if (!erased?.has(stroke.id)) drawStroke(ctx, stroke)
    }
    paintLive()
  }
  function announceView() {
    if (!size.current.width || !live.current) return
    // Also useful when inspecting pen coordinates in browser developer tools.
    live.current.dataset.viewX = String(camera.current.x); live.current.dataset.viewY = String(camera.current.y)
    live.current.dataset.scale = String(scale()); live.current.dataset.zoom = String(camera.current.zoom)
    latest.current.onView({ ...camera.current, ...area() })
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(saveView, 200)
  }
  function schedule(full = false, viewChanged = false) {
    repaint.current ||= full; report.current ||= viewChanged
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (repaint.current) paint(); else paintLive()
      if (report.current) announceView()
      repaint.current = false; report.current = false
    })
  }
  function setCamera(x: number, y: number, zoom: number) {
    camera.current.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    camera.current.x = clamp(x, -WORLD_LIMIT, WORLD_LIMIT - size.current.width / scale())
    camera.current.y = clamp(y, -WORLD_LIMIT, WORLD_LIMIT - size.current.height / scale())
    schedule(true, true)
  }
  function zoomAt(position: Position, zoom: number) {
    const anchor = world(position), next = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    const factor = size.current.width / PAGE_WIDTH * next
    setCamera(anchor.x - position.x / factor, anchor.y - position.y / factor, next)
  }
  function returnToWriting() {
    if (gesture.current || !size.current.width) return
    let point = camera.current.writing
    if (!point) {
      // Older notebooks have no remembered pen location; start near their last writing.
      let bottom = -Infinity
      for (const page of latest.current.pages) for (const stroke of page.strokes) {
        const box = strokeBounds(stroke)
        if (box.y + box.height > bottom) { bottom = box.y + box.height; point = stroke.points.at(-1)!.slice(0, 2) as [number, number] }
      }
    }
    const y = point ? point[1] - size.current.height / (size.current.width / PAGE_WIDTH) * .45 : 0
    setCamera(point ? Math.floor(point[0] / PAGE_WIDTH) * PAGE_WIDTH : 0, point && point[1] < 0 ? y : Math.max(0, y), 1)
    live.current?.focus({ preventScroll: true }); saveView()
  }
  useImperativeHandle(ref, () => ({ returnToWriting,
    resetZoom: () => { if (!gesture.current && size.current.width) zoomAt({ x: size.current.width / 2, y: size.current.height / 2 }, 1) } }))

  useLayoutEffect(() => {
    const element = sheet.current!
    const resize = () => {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return // Text view / mobile chat tab can hide the canvas.
      size.current = { width, height, ratio: Math.min(devicePixelRatio || 1, 3) }
      for (const layer of [base.current!, live.current!]) {
        layer.width = Math.round(width * size.current.ratio)
        layer.height = Math.round(height * size.current.ratio)
      }
      // Layout can change while ink is arriving (rotation, save notices, tabs).
      // Keep the in-progress stroke in world coordinates instead of losing it.
      touches.current.clear(); navigation.current = null; mouse.current = null
      paint(); announceView()
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (gesture.current || latest.current.disabled || !size.current.width) return
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.current.height : 1
      const dx = event.deltaX * multiplier, dy = event.deltaY * multiplier
      if (event.ctrlKey || event.metaKey) zoomAt(position(event), camera.current.zoom * Math.exp(-dy * .002))
      else setCamera(camera.current.x + (event.shiftKey && !dx ? dy : dx) / scale(),
        camera.current.y + (event.shiftKey && !dx ? 0 : dy) / scale(), camera.current.zoom)
    }
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    element.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('pagehide', saveView)
    return () => {
      observer.disconnect(); element.removeEventListener('wheel', wheel); window.removeEventListener('pagehide', saveView)
      cancelAnimationFrame(frame.current); saveView()
    }
  }, [])
  useLayoutEffect(() => { schedule(true) }, [props.pages, props.selected])
  useLayoutEffect(() => {
    gesture.current = null; touches.current.clear(); navigation.current = null; mouse.current = null; schedule(true)
  }, [props.tool, props.disabled])

  function position(event: { clientX: number; clientY: number }): Position {
    const box = live.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  function point(event: PointerEvent): Point {
    // Read the current CSS geometry, including an in-progress sidebar resize.
    const box = live.current!.getBoundingClientRect(), factor = box.width / PAGE_WIDTH * camera.current.zoom
    return [clamp(camera.current.x + (event.clientX - box.left) / factor, -WORLD_LIMIT, WORLD_LIMIT),
      clamp(camera.current.y + (event.clientY - box.top) / factor, -WORLD_LIMIT, WORLD_LIMIT), event.pressure || gesture.current?.last[2] || .5]
  }
  function capture(event: ReactPointerEvent<HTMLCanvasElement>) {
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic events have no capture. */ }
  }
  function touchGeometry() {
    const [a, b] = [...touches.current.values()]
    return b ? { midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(b.x - a.x, b.y - a.y) }
      : { midpoint: a, distance: 0 }
  }
  function startNavigation() {
    if (touches.current.size >= 2 || (latest.current.tool === 'move' && touches.current.size)) {
      const { midpoint, distance } = touchGeometry()
      navigation.current = { anchor: world(midpoint), distance, zoom: camera.current.zoom }
    } else navigation.current = null
  }
  function navigate(midpoint: Position, distance: number) {
    const nav = navigation.current
    if (!nav) return
    const zoom = clamp(nav.zoom * (nav.distance >= 8 && distance >= 8 ? distance / nav.distance : 1), MIN_ZOOM, MAX_ZOOM)
    const factor = size.current.width / PAGE_WIDTH * zoom
    setCamera(nav.anchor.x - midpoint.x / factor, nav.anchor.y - midpoint.y / factor, zoom)
  }
  function eraseSegment(g: Gesture, next: Point) {
    const rect = rectangle(g.last, next), pad = 32
    for (const stroke of visibleStrokes(latest.current.pages, { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 })) {
      if (!g.erased.has(stroke.id) && eraserHits(stroke, g.last, next)) g.erased.add(stroke.id)
    }
  }
  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (latest.current.disabled || !size.current.width) return
    if (event.pointerType === 'touch') {
      // A single resting palm never moves the page. Contacts present during pen
      // input must lift before they can start a fresh navigation gesture.
      if (gesture.current || touches.current.size >= 2 || event.width > 60 || event.height > 60) return
      event.preventDefault(); capture(event)
      touches.current.set(event.pointerId, position(event)); startNavigation(); return
    }
    if (gesture.current || (event.button !== 0 && event.button !== 5 && !(event.buttons & 32))) return
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); capture(event)
    touches.current.clear(); navigation.current = null
    if (latest.current.tool === 'move') {
      mouse.current = event.pointerId
      navigation.current = { anchor: world(position(event)), distance: 0, zoom: camera.current.zoom }; return
    }
    const tool = event.button === 5 || event.buttons & 32 ? 'erase' : latest.current.tool
    const start = point(event.nativeEvent)
    latest.current.onSelect(null)
    const g: Gesture = { pointer: event.pointerId, tool, start, last: start, erased: new Set(), stroke: { id: inkId(), points: [start], size: 4 } }
    gesture.current = g
    if (tool === 'erase') eraseSegment(g, start)
    schedule(tool === 'erase')
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      if (!touches.current.has(event.pointerId) || gesture.current) return
      event.preventDefault(); touches.current.set(event.pointerId, position(event))
      const { midpoint, distance } = touchGeometry(); navigate(midpoint, distance); return
    }
    if (mouse.current === event.pointerId) { event.preventDefault(); navigate(position(event), 0); return }
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    event.preventDefault()
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      const next = point(sample)
      if (g.tool === 'pen') {
        if (g.stroke.points.length >= 10_000) {
          finish(event); latest.current.onError('Lift your pen to continue this stroke.'); return
        }
        if (Math.hypot(next[0] - g.last[0], next[1] - g.last[1]) > .25) g.stroke.points.push(next)
      }
      if (g.tool === 'erase') eraseSegment(g, next)
      g.last = next
    }
    schedule(g.tool === 'erase')
  }
  function finish(event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (touches.current.delete(event.pointerId)) { startNavigation(); saveView() }
    if (mouse.current === event.pointerId) { mouse.current = null; navigation.current = null; saveView() }
    const g = gesture.current
    if (g?.pointer === event.pointerId) {
      const end = point(event.nativeEvent)
      gesture.current = null
      if (!cancelled) {
        if (g.tool === 'pen') {
          if (g.stroke.points.length < 10_000 && Math.hypot(end[0] - g.last[0], end[1] - g.last[1]) > .25) g.stroke.points.push(end)
          latest.current.onStroke(g.stroke); camera.current.writing = [end[0], end[1]]; saveView()
        }
        if (g.tool === 'erase') { eraseSegment(g, end); latest.current.onErase(g.erased) }
        if (g.tool === 'select') {
          const rect = rectangle(g.start, end)
          latest.current.onSelect(rect.width >= 2 && rect.height >= 2 ? rect : null)
        }
      }
      schedule(true)
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div ref={sheet} className="ink-sheet">
    <canvas ref={base} className="ink-committed" aria-hidden="true" />
    <canvas ref={live} className={`ink-live ink-tool-${props.tool}`} aria-label="Ink canvas" aria-describedby="ink-navigation-help" tabIndex={0}
      aria-disabled={props.disabled} onPointerDown={down} onPointerMove={move}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)} onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (props.disabled || gesture.current || event.ctrlKey || event.metaKey || event.altKey) return
        const offsets: Record<string, [number, number]> = { ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0],
          PageUp: [0, -size.current.height * .85], PageDown: [0, size.current.height * .85] }
        const delta = offsets[event.key]
        if (delta) { event.preventDefault(); setCamera(camera.current.x + delta[0] / scale(), camera.current.y + delta[1] / scale(), camera.current.zoom) }
        if (event.key === 'Home') { event.preventDefault(); returnToWriting() }
      }}>
      Continuous handwritten notebook. Write with a pen; use two fingers to pan and pinch to zoom.
    </canvas>
  </div>
})
