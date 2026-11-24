import { strokeBounds, type InkPageData, type Rect } from './ink'

function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}
function enclosing(boxes: Rect[]): Rect {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const box of boxes) {
    x = Math.min(x, box.x); y = Math.min(y, box.y)
    right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height)
  }
  return { x, y, width: right - x, height: bottom - y }
}

// Work in document coordinates, independent of zoom and the viewport. Split at
// whitespace where possible; giant diagrams may still cross a section boundary.
export function conversionAreas(pages: InkPageData[], selection: Rect | null): Rect[] {
  const boxes = pages.flatMap(page => page.strokes.map(strokeBounds))
    .map(box => selection ? intersection(box, selection) : box).filter((box): box is Rect => box !== null)
  if (!boxes.length) throw new Error('Select an area containing handwriting, or write something first.')
  const result: Rect[] = []
  const content = enclosing(boxes)
  const padded = { x: content.x - 24, y: content.y - 24, width: content.width + 48, height: content.height + 48 }
  const clip = selection ? intersection(padded, selection)! : padded
  function split(boxes: Rect[], region: Rect) {
    if (!boxes.length) return
    if (result.length >= 64) throw new Error('This notebook needs more than 64 sections. Select a smaller part to convert.')
    const bounds = enclosing(boxes)
    const area = intersection({ x: bounds.x - 24, y: bounds.y - 24, width: bounds.width + 48, height: bounds.height + 48 }, region)!
    if (area.width <= 1200 && area.height <= 1600) { result.push(area); return }
    const axis = area.height > 1600 ? 'y' : 'x', size = axis === 'y' ? 'height' : 'width'
    const middle = area[axis] + area[size] / 2
    const intervals = boxes.map(box => [box[axis], box[axis] + box[size]]).sort((a, b) => a[0] - b[0])
    let cut = middle, best = Infinity, end = intervals[0][1]
    for (const [start, stop] of intervals.slice(1)) {
      const gap = (end + start) / 2
      if (start > end && gap > area[axis] + area[size] * .2 && gap < area[axis] + area[size] * .8
        && Math.abs(gap - middle) < best) { cut = gap; best = Math.abs(gap - middle) }
      end = Math.max(end, stop)
    }
    const first = { ...area, [size]: cut - area[axis] }
    const second = { ...area, [axis]: cut, [size]: area[axis] + area[size] - cut }
    for (const half of [first, second]) {
      split(boxes.map(box => intersection(box, half)).filter((box): box is Rect => box !== null), half)
    }
  }
  split(boxes, clip)
  return result
}
