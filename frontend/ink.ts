import { getStroke } from 'perfect-freehand'

export type Point = [number, number, number]
export type Stroke = { id: string; points: Point[]; size: number }
export type InkPageData = { id: string; width: 1000; height: 1414; strokes: Stroke[]; revision: number; mutation_id: string }
export type Rect = { x: number; y: number; width: number; height: number }
export type InkTool = 'pen' | 'erase' | 'select' | 'move'
export const PAGE_WIDTH = 1000, PAGE_HEIGHT = 1414
export function inkId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  // Basic writing also works on private HTTP; HTTPS enables richer pen events/PWA support.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function newInkPage(): InkPageData {
  return { id: inkId(), width: PAGE_WIDTH, height: PAGE_HEIGHT, strokes: [], revision: 0, mutation_id: inkId() }
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, color = '#f1f1f1', complete = true) {
  const outline = getStroke(stroke.points, { size: stroke.size, thinning: .55, smoothing: .5, streamline: .25, simulatePressure: false, last: complete })
  if (!outline.length) return
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1])
  ctx.closePath(); ctx.fill()
}

export function rectangle(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }
}
function distance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
}
export function eraserHits(stroke: Stroke, a: Point, b: Point) {
  const radius = 12 + stroke.size / 2
  return stroke.points.some((c, i, points) => {
    const d = points[Math.max(0, i - 1)]
    return intersects(a, b, c, d) || Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b)) <= radius
  })
}
export function snapshot(page: InkPageData, rect?: Rect): string {
  const area = rect ?? { x: 0, y: 0, width: page.width, height: page.height }
  if (area.width < 2 || area.height < 2) throw new Error('Select a larger area of the page.')
  const canvas = document.createElement('canvas')
  // Keep the short side within two image tiles so a whole page fits the default context budget.
  const scale = Math.min(2, 1536 / Math.max(area.width, area.height), 1024 / Math.min(area.width, area.height))
  canvas.width = Math.max(1, Math.round(area.width * scale)); canvas.height = Math.max(1, Math.round(area.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale); ctx.translate(-area.x, -area.y)
  for (const stroke of page.strokes) drawStroke(ctx, stroke, '#111')
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let hasInk = false
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 250) { hasInk = true; break }
  if (!hasInk) throw new Error('Select an area containing some handwriting.')
  const image = canvas.toDataURL('image/png')
  if (image.length > 4_000_000) throw new Error('This snapshot is too large. Select a smaller area.')
  return image
}
