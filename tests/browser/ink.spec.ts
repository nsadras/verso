import { expect, test, type Page, type Locator } from '@playwright/test'

async function showPanel(page: Page, mobile: boolean, name = 'Notebook') {
  if (mobile) await page.getByRole('navigation', { name: 'Workspace panel' }).getByRole('button', { name, exact: true }).click()
}
async function openInk(page: Page, mobile: boolean) {
  const topic = await (await page.request.post('/api/topics', { data: { title: 'Handwritten notes' } })).json()
  await page.request.put('/api/settings', { data: { model: `ink-test-${topic.id}`, context_window: 32768 } })
  await page.addInitScript(id => localStorage.setItem('verso.active-topic', id), topic.id)
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await showPanel(page, mobile)
  await page.getByRole('button', { name: 'Ink', exact: true }).click()
  await expect(page.getByLabel('Ink page 1', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  return topic.id as string
}
async function stroke(canvas: Locator, points = [[100, 100], [130, 170], [180, 110]], type = 'pen', cancelled = false) {
  const box = (await canvas.boundingBox())!
  const pointer = (p: number[], buttons = 1) => ({ pointerType: type, pointerId: 9, button: 0, buttons, pressure: .7,
    clientX: box.x + p[0] * box.width / 1000, clientY: box.y + p[1] * box.height / 1414 })
  await canvas.dispatchEvent('pointerdown', pointer(points[0]))
  for (const p of points.slice(1)) await canvas.dispatchEvent('pointermove', pointer(p))
  await canvas.dispatchEvent(cancelled ? 'pointercancel' : 'pointerup', pointer(points[points.length - 1], 0))
}
async function savedPages(page: Page, topic: string) { return (await page.request.get(`/api/topics/${topic}/ink-pages`)).json() }
async function count(page: Page, topic: string, n: number) {
  await expect.poll(async () => (await savedPages(page, topic))[0]?.strokes.length).toBe(n)
}

test('ink persists editable strokes, ignores palms, and supports erasing, undo, pages and typed notes', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const canvas = page.getByLabel('Ink page 1', { exact: true })
  await stroke(canvas, undefined, 'touch')
  await stroke(canvas, undefined, 'pen', true)
  await count(page, id, 0)
  await stroke(canvas)
  await count(page, id, 1)
  const original = (await savedPages(page, id))[0].strokes
  expect(original[0].points[0][2]).toBeCloseTo(.7)
  await page.getByRole('button', { name: 'Eraser', exact: true }).click()
  await stroke(canvas, [[90, 100], [140, 100]])
  await count(page, id, 0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await count(page, id, 1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await count(page, id, 0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await count(page, id, 1)
  await page.getByRole('button', { name: '+ Page', exact: true }).click()
  await stroke(page.getByLabel('Ink page 2', { exact: true }), [[100, 100], [250, 100]])
  await expect.poll(async () => (await savedPages(page, id))[1]?.strokes.length).toBe(1)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByRole('textbox', { name: 'Notebook', exact: true }).fill('Typed notes stay separate.')
  await expect(page.getByText('✓ Saved on host')).toBeVisible()
  await page.getByRole('button', { name: 'Ink', exact: true }).click()
  await page.reload(); await showPanel(page, isMobile)
  await expect(canvas).toBeVisible()
  expect((await savedPages(page, id))[0].strokes).toEqual(original)
  await expect(page.getByLabel('Ink page 2', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(canvas).toHaveCSS('touch-action', 'pan-y pinch-zoom')
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await expect(canvas).toHaveCSS('touch-action', 'none')
  await page.screenshot({ path: `test-results/ink-${isMobile ? 'mobile' : 'desktop'}.png` })
})

test('ink recovery survives a failed save and refresh, and retries a lost acknowledgement', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const url = `**/topics/${id}/ink-pages/*`
  await page.route(url, route => route.abort('failed'))
  await stroke(page.getByLabel('Ink page 1', { exact: true }))
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on tablet')
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on tablet')
  const recovered = await page.locator('.ink-committed').evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value > 0))
  expect(recovered).toBeTruthy()
  await page.unroute(url)
  let lost = false
  await page.route(url, async route => {
    if (!lost && route.request().method() === 'PUT') {
      lost = true; await route.fetch(); await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => lost).toBeTruthy()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  await count(page, id, 1)
  expect((await savedPages(page, id))[0].revision).toBe(2)
})

test('ink conflicts retain both versions until the user chooses, including after refresh', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const original = (await savedPages(page, id))[0]
  const remote = { ...original, mutation_id: crypto.randomUUID(), strokes: [{ id: crypto.randomUUID(), size: 4, points: [[600, 600, .5]] }] }
  await page.request.put(`/api/topics/${id}/ink-pages/${original.id}`, { data: remote })
  await stroke(page.getByLabel('Ink page 1', { exact: true }))
  await expect(page.getByRole('button', { name: 'Keep tablet page' })).toBeVisible()
  expect((await savedPages(page, id))[0].strokes).toEqual(remote.strokes)
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByRole('button', { name: 'Keep tablet page' })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Keep tablet page' }).click()
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  expect((await savedPages(page, id))[0].strokes[0].points[0][0]).toBeCloseTo(100)
})

test('verified image actions capture selected unsaved ink and survive reload and follow-ups', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'verify image support', exact: true }).click()
  await page.getByRole('button', { name: 'Save & verify images', exact: true }).click()
  await expect(page.getByText(/^Image support verified\. You can now/)).toBeVisible()
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await page.route(`**/topics/${id}/ink-pages/*`, route => route.abort('failed'))
  const canvas = page.getByLabel('Ink page 1', { exact: true })
  await stroke(canvas)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await stroke(canvas, [[70, 70], [210, 210]])
  await expect(page.locator('#ink-action-scope')).toHaveText('selection')
  const request = page.waitForRequest(request => request.url().endsWith(`/topics/${id}/messages`))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const body = (await request).postDataJSON()
  expect(body.action).toBe('check')
  expect(body.content).toBe('Selection from handwritten page 1')
  expect(body.image).toMatch(/^data:image\/png;base64,/)
  const size = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode(); return [image.naturalWidth, image.naturalHeight]
  }, body.image)
  expect(size[0]).toBeLessThan(300)
  await expect(page.locator('.diary-snapshot')).toBeVisible()
  await expect(page.locator('.diary-action')).toHaveText('Check')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  expect((await savedPages(page, id))[0].strokes).toEqual([])
  await page.reload()
  await expect(page.locator('.diary-snapshot')).toHaveAttribute('src', /^data:image\/png;base64,/)
  const editor = page.getByRole('textbox', { name: 'Message', exact: true })
  await editor.fill('recall-image'); await editor.press('Enter')
  await expect(page.locator('.diary-response')).toHaveText('The handwritten image is still in context.')
  await expect(editor).toBeEnabled()
  // The whole page must also fit the default context, with older images omitted as needed.
  const settings = await (await page.request.get('/api/settings')).json()
  await page.request.put('/api/settings', { data: { ...settings, context_window: 8192 } })
  await page.reload(); await showPanel(page, isMobile)
  await expect(canvas).toBeVisible()
  await expect(page.locator('#ink-action-scope')).toHaveText('page')
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await expect(page.locator('.diary-response')).toHaveText('Consider how this idea connects to linearity.')
  await expect(page.locator('.diary-snapshot')).toHaveAttribute('alt', 'Handwritten page 1')
})

test('new strokes made during an in-flight save are synchronized without losing either edit', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  let release: (() => void) | undefined
  let held = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/topics/${id}/ink-pages/*`, async route => {
    if (!held && route.request().method() === 'PUT') { held = true; await gate }
    await route.continue()
  })
  const canvas = page.getByLabel('Ink page 1', { exact: true })
  await stroke(canvas)
  await expect.poll(() => held).toBeTruthy()
  await stroke(canvas, [[300, 300], [350, 400]])
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on tablet')
  release!()
  await count(page, id, 2)
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByLabel('Ink page 1', { exact: true })).toBeVisible()
  const strokes = (await savedPages(page, id))[0].strokes
  expect(strokes[0].points[0][0]).toBeCloseTo(100)
  expect(strokes[1].points[0][0]).toBeCloseTo(300)
})

test('a populated ink page remains writable during streaming and keeps coordinates after resize', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const saved = (await savedPages(page, id))[0]
  const strokes = Array.from({ length: 300 }, (_, i) => ({ id: crypto.randomUUID(), size: 4,
    points: [[30 + i % 20 * 45, 30 + Math.floor(i / 20) * 80, .4], [50 + i % 20 * 45, 50 + Math.floor(i / 20) * 80, .8]] }))
  await page.request.put(`/api/topics/${id}/ink-pages/${saved.id}`, { data: { ...saved, strokes, mutation_id: crypto.randomUUID() } })
  await page.reload()
  const editor = page.getByRole('textbox', { name: 'Message', exact: true })
  await editor.fill('long-response'); await editor.press('Enter')
  await expect(page.getByText(/^Paragraph 1\./)).toBeVisible()
  await showPanel(page, isMobile)
  const canvas = page.getByLabel('Ink page 1', { exact: true })
  await expect(canvas).toHaveAttribute('aria-disabled', 'false')
  await stroke(canvas)
  await count(page, id, 301)
  const before = (await savedPages(page, id))[0]
  await page.setViewportSize({ width: isMobile ? 850 : 1000, height: isMobile ? 500 : 900 })
  await expect(canvas).toBeVisible()
  await stroke(canvas, [[300, 300], [350, 350]])
  await count(page, id, 302)
  const after = (await savedPages(page, id))[0]
  expect(after.strokes.slice(0, 301)).toEqual(before.strokes)
  expect(after.strokes[301].points[0][0]).toBeCloseTo(300)
  expect(after.strokes[301].points[0][1]).toBeCloseTo(300)
})
