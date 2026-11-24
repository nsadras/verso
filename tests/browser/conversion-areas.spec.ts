import { expect, test } from '@playwright/test'
import { conversionAreas } from '../../frontend/inkConversion'
import type { InkPageData, Rect } from '../../frontend/ink'

function pages(points: number[][]): InkPageData[] {
  return [{ id: 'test', width: 1000, height: 1414, space: 'canvas', revision: 0, mutation_id: 'test',
    strokes: points.map(([x, y], index) => ({ id: String(index), size: 4, points: [[x, y, .7], [x + 70, y + 40, .8]] })) }]
}
const contains = (area: Rect, x: number, y: number) => area.x <= x && x <= area.x + area.width && area.y <= y && y <= area.y + area.height

test('conversion covers distant and negative coordinates at readable size without overlapping images', () => {
  const notes = pages([[-1800, -2000], [50, 100], [1900, 100], [100, 3200], [100, 12000]])
  const areas = conversionAreas(notes, null)
  expect(areas.length).toBeGreaterThan(1)
  for (const stroke of notes[0].strokes) for (const [x, y] of stroke.points) expect(areas.some(area => contains(area, x, y))).toBe(true)
  for (const [i, area] of areas.entries()) {
    expect(area.width).toBeLessThanOrEqual(1200); expect(area.height).toBeLessThanOrEqual(1600)
    for (const other of areas.slice(i + 1)) {
      const overlap = Math.min(area.x + area.width, other.x + other.width) > Math.max(area.x, other.x)
        && Math.min(area.y + area.height, other.y + other.height) > Math.max(area.y, other.y)
      expect(overlap).toBe(false)
    }
  }
})

test('selection conversion clips every image to the selection, including split strokes', () => {
  const notes = pages([[0, 0], [20, 3000], [3000, 4000]])
  notes[0].strokes.push({ id: 'connector', size: 4, points: [[40, -1000, .5], [40, 5000, .5]] })
  const selected = { x: 30, y: 20, width: 500, height: 3500 }
  const areas = conversionAreas(notes, selected)
  expect(areas.length).toBeGreaterThan(1)
  for (const area of areas) {
    expect(contains(selected, area.x, area.y)).toBe(true)
    expect(contains(selected, area.x + area.width, area.y + area.height)).toBe(true)
  }
  for (let y = 20; y <= 3520; y += 50) expect(areas.some(area => contains(area, 40, y))).toBe(true)
})

test('conversion refuses empty and excessively large notebooks before starting a partial job', () => {
  expect(() => conversionAreas(pages([]), null)).toThrow(/write something/)
  expect(() => conversionAreas(pages([[0, 0]]), { x: 500, y: 500, width: 100, height: 100 })).toThrow(/Select/)
  expect(() => conversionAreas(pages(Array.from({ length: 65 }, (_, i) => [0, i * 2000])), null)).toThrow(/64 sections/)
})
