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
  await expect(page.getByLabel('Ink canvas', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  return topic.id as string
}
async function stroke(canvas: Locator, points = [[100, 100], [130, 170], [180, 110]], type = 'pen', cancelled = false) {
  // Let panel transitions settle before converting known document positions to
  // synthetic screen positions; the actual gesture still arrives sample by sample.
  await canvas.click({ trial: true })
  const view = await camera(canvas)
  const box = (await canvas.boundingBox())!
  const pointer = (p: number[], buttons = 1) => ({ pointerType: type, pointerId: 9, button: 0, buttons, pressure: .7,
    clientX: box.x + (p[0] - view.x) * view.scale, clientY: box.y + (p[1] - view.y) * view.scale })
  await canvas.dispatchEvent('pointerdown', pointer(points[0]))
  for (const p of points.slice(1)) await canvas.dispatchEvent('pointermove', pointer(p))
  await canvas.dispatchEvent(cancelled ? 'pointercancel' : 'pointerup', pointer(points[points.length - 1], 0))
}
async function savedPages(page: Page, topic: string) { return (await page.request.get(`/api/topics/${topic}/ink-pages`)).json() }
async function count(page: Page, topic: string, n: number) {
  await expect.poll(async () => (await savedPages(page, topic)).reduce((sum: number, section: { strokes: unknown[] }) => sum + section.strokes.length, 0)).toBe(n)
}
async function camera(canvas: Locator) {
  await expect(canvas).toHaveAttribute('data-scale', /\d/)
  await expect.poll(() => canvas.evaluate(element => Math.abs(Number(element.dataset.scale)
    - element.getBoundingClientRect().width / 1000 * Number(element.dataset.zoom)))).toBeLessThan(.0001)
  return canvas.evaluate(element => ({ x: Number(element.dataset.viewX), y: Number(element.dataset.viewY),
    scale: Number(element.dataset.scale), zoom: Number(element.dataset.zoom) }))
}
async function pan(canvas: Locator, x: number, y: number) {
  const before = await camera(canvas)
  await canvas.dispatchEvent('wheel', { deltaX: x * before.scale, deltaY: y * before.scale })
  await expect.poll(async () => (await camera(canvas)).x).toBeCloseTo(before.x + x)
  await expect.poll(async () => (await camera(canvas)).y).toBeCloseTo(before.y + y)
}
async function touch(canvas: Locator, event: string, id: number, x: number, y: number) {
  const box = (await canvas.boundingBox())!
  await canvas.dispatchEvent(event, { pointerType: 'touch', pointerId: id, button: 0, buttons: event === 'pointerup' ? 0 : 1,
    width: 10, height: 10, clientX: box.x + box.width * x, clientY: box.y + box.height * y })
}

test('ink persists editable strokes, ignores palms, and supports erasing, undo, continuous space and typed notes', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const canvas = page.getByLabel('Ink canvas', { exact: true })
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
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await pan(canvas, 1100, 3000)
  await stroke(canvas, [[1200, 3100], [1350, 3100]])
  await count(page, id, 2)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByRole('textbox', { name: 'Notebook', exact: true }).fill('Typed notes stay separate.')
  await expect(page.getByText('✓ Saved on host')).toBeVisible()
  await page.getByRole('button', { name: 'Ink', exact: true }).click()
  await page.reload(); await showPanel(page, isMobile)
  await expect(canvas).toBeVisible()
  expect((await savedPages(page, id))[0].strokes).toEqual(original)
  expect((await camera(canvas)).y).toBeCloseTo(3000)
  await expect(page.locator('.ink-live')).toHaveCount(1)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(canvas).toHaveCSS('touch-action', 'none')
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await expect(canvas).toHaveCSS('touch-action', 'none')
  await page.screenshot({ path: `test-results/ink-${isMobile ? 'mobile' : 'desktop'}.png` })
})

test('ink recovery survives a failed save and refresh, and retries a lost acknowledgement', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const url = `**/topics/${id}/ink-pages/*`
  await page.route(url, route => route.abort('failed'))
  await stroke(page.getByLabel('Ink canvas', { exact: true }))
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
  await stroke(page.getByLabel('Ink canvas', { exact: true }))
  await expect(page.getByRole('button', { name: 'Keep tablet ink' })).toBeVisible()
  expect((await savedPages(page, id))[0].strokes).toEqual(remote.strokes)
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByRole('button', { name: 'Keep tablet ink' })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Keep tablet ink' }).click()
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
  const canvas = page.getByLabel('Ink canvas', { exact: true })
  await stroke(canvas)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await stroke(canvas, [[70, 70], [210, 210]])
  await expect(page.locator('#ink-action-scope')).toHaveText('selection')
  const request = page.waitForRequest(request => request.url().endsWith(`/topics/${id}/messages`))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const body = (await request).postDataJSON()
  expect(body.action).toBe('check')
  expect(body.content).toBe('Selected handwriting')
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
  // The visible writing must also fit the default context, with older images omitted as needed.
  const settings = await (await page.request.get('/api/settings')).json()
  await page.request.put('/api/settings', { data: { ...settings, context_window: 8192 } })
  await page.reload(); await showPanel(page, isMobile)
  await expect(canvas).toBeVisible()
  await expect(page.locator('#ink-action-scope')).toHaveText('view')
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await expect(page.locator('.diary-response')).toHaveText('Consider how this idea connects to linearity.')
  await expect(page.locator('.diary-snapshot')).toHaveAttribute('alt', 'Visible handwriting')
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
  const canvas = page.getByLabel('Ink canvas', { exact: true })
  await stroke(canvas)
  await expect.poll(() => held).toBeTruthy()
  await stroke(canvas, [[300, 300], [350, 400]])
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on tablet')
  release!()
  await count(page, id, 2)
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByLabel('Ink canvas', { exact: true })).toBeVisible()
  const strokes = (await savedPages(page, id))[0].strokes
  expect(strokes[0].points[0][0]).toBeCloseTo(100)
  expect(strokes[1].points[0][0]).toBeCloseTo(300)
})

test('a full ink section grows during streaming and keeps coordinates after resize', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const saved = (await savedPages(page, id))[0]
  const strokes = Array.from({ length: 500 }, (_, i) => ({ id: crypto.randomUUID(), size: 4,
    points: [[30 + i % 20 * 45, 30 + Math.floor(i / 20) * 80, .4], [50 + i % 20 * 45, 50 + Math.floor(i / 20) * 80, .8]] }))
  await page.request.put(`/api/topics/${id}/ink-pages/${saved.id}`, { data: { ...saved, strokes, mutation_id: crypto.randomUUID() } })
  await page.reload()
  const editor = page.getByRole('textbox', { name: 'Message', exact: true })
  await editor.fill('long-response'); await editor.press('Enter')
  await expect(page.getByText(/^Paragraph 1\./)).toBeVisible()
  await showPanel(page, isMobile)
  const canvas = page.getByLabel('Ink canvas', { exact: true })
  await expect(canvas).toHaveAttribute('aria-disabled', 'false')
  await stroke(canvas)
  await count(page, id, 501)
  const before = await savedPages(page, id)
  expect(before).toHaveLength(2)
  expect(before[0].strokes).toEqual(strokes)
  expect(before[1].strokes).toHaveLength(1)
  await page.setViewportSize({ width: isMobile ? 850 : 1000, height: isMobile ? 500 : 900 })
  await expect(canvas).toBeVisible()
  await stroke(canvas, [[300, 300], [350, 350]])
  await count(page, id, 502)
  const after = await savedPages(page, id)
  expect(after[0]).toEqual(before[0]) // Filling a section never rewrites or shifts earlier notes.
  expect(after[1].strokes[0]).toEqual(before[1].strokes[0])
  expect(after[1].strokes[1].points[0][0]).toBeCloseTo(300)
  expect(after[1].strokes[1].points[0][1]).toBeCloseTo(300)
})

test('pinch anchors the writing, pans sideways, restores the view and keeps pen coordinates accurate', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const canvas = page.getByLabel('Ink canvas', { exact: true }), box = (await canvas.boundingBox())!
  const initial = await camera(canvas), anchor = [500, box.height * .4 / initial.scale]
  await stroke(canvas, [[anchor[0] - 30, anchor[1]], [anchor[0] + 30, anchor[1]]])
  await count(page, id, 1)
  const browserZoom = await page.evaluate(() => window.visualViewport!.scale)
  // Real browser touch input exercises pointer capture and touch-action as well
  // as the gesture math (desktop and Android emulation both run Chromium).
  const cdp = await page.context().newCDPSession(page)
  const fingers = (spread: number, y: number) => [
    { id: 1, x: box.x + box.width * (.5 - spread), y: box.y + box.height * y },
    { id: 2, x: box.x + box.width * (.5 + spread), y: box.y + box.height * y },
  ]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(.2, .4) })
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(.2 + i / 60, .4 + i / 60) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await camera(canvas)).zoom).toBeCloseTo(1.5, 1)
  const zoomed = await camera(canvas)
  expect(zoomed.x + box.width * .5 / zoomed.scale).toBeCloseTo(anchor[0], 0)
  expect(zoomed.y + box.height * .5 / zoomed.scale).toBeCloseTo(anchor[1], 0)
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(browserZoom)
  await stroke(canvas, [[500, anchor[1] + 80], [550, anchor[1] + 100]])
  await count(page, id, 2)
  const second = (await savedPages(page, id))[0].strokes[1]
  expect(second.points[0][0]).toBeCloseTo(500)
  expect(second.points[0][1]).toBeCloseTo(anchor[1] + 80)
  await pan(canvas, -1400, 3200)
  const moved = await camera(canvas)
  await stroke(canvas, [[moved.x + 100, moved.y + 100], [moved.x + 250, moved.y + 120]])
  await count(page, id, 3)
  await page.reload(); await showPanel(page, isMobile)
  await expect(canvas).toBeVisible()
  const restored = await camera(canvas)
  expect(restored.x).toBeCloseTo(moved.x); expect(restored.y).toBeCloseTo(moved.y); expect(restored.zoom).toBeCloseTo(moved.zoom)
  await page.getByRole('button', { name: 'Return to writing', exact: true }).click()
  await expect.poll(async () => (await camera(canvas)).zoom).toBe(1)
  const returned = await camera(canvas)
  expect(moved.x + 250).toBeGreaterThanOrEqual(returned.x)
  expect(moved.y + 120).toBeGreaterThanOrEqual(returned.y)
  expect(moved.y + 120).toBeLessThan(returned.y + (await canvas.boundingBox())!.height / returned.scale)
  // Storage grows; the two canvas bitmaps remain the size of this viewport.
  const layers = await page.locator('.ink-sheet canvas').evaluateAll(elements => elements.map(element => {
    const canvas = element as HTMLCanvasElement, box = canvas.getBoundingClientRect()
    return canvas.width <= Math.ceil(box.width * 3) && canvas.height <= Math.ceil(box.height * 3)
  }))
  expect(layers).toEqual([true, true])
})

test('Move supports one finger, pen input excludes navigation, and interrupted gestures leave no ink', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile), canvas = page.getByLabel('Ink canvas', { exact: true })
  const start = await camera(canvas)
  await touch(canvas, 'pointerdown', 1, .5, .5)
  await touch(canvas, 'pointermove', 1, .5, .3)
  await touch(canvas, 'pointerup', 1, .5, .3)
  expect(await camera(canvas)).toEqual(start)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await touch(canvas, 'pointerdown', 1, .5, .5)
  await touch(canvas, 'pointermove', 1, .4, .3)
  await touch(canvas, 'pointercancel', 1, .4, .3)
  await expect.poll(async () => (await camera(canvas)).y).toBeGreaterThan(start.y)
  const moved = await camera(canvas)
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  const box = (await canvas.boundingBox())!
  const pen = { pointerType: 'pen', pointerId: 9, button: 0, buttons: 1, pressure: .8,
    clientX: box.x + 40, clientY: box.y + 40 }
  await canvas.dispatchEvent('pointerdown', pen)
  await touch(canvas, 'pointerdown', 1, .3, .4)
  await touch(canvas, 'pointerdown', 2, .6, .4)
  await touch(canvas, 'pointermove', 1, .1, .7)
  await canvas.dispatchEvent('wheel', { deltaY: 100 })
  await canvas.dispatchEvent('pointermove', { ...pen, clientY: pen.clientY + 40 })
  await canvas.dispatchEvent('pointerup', { ...pen, clientY: pen.clientY + 40, buttons: 0 })
  await touch(canvas, 'pointerup', 1, .1, .7)
  await touch(canvas, 'pointerup', 2, .6, .4)
  expect(await camera(canvas)).toEqual(moved)
  await count(page, id, 1)
  await stroke(canvas, [[200, moved.y + 200], [250, moved.y + 250]], 'pen', true)
  await count(page, id, 1)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
})

for (const acknowledged of [true, false]) test(`legacy pages recover an ${acknowledged ? 'acknowledged' : 'unsent'} tablet request without duplicate ink`, async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile)
  const first = (await savedPages(page, id))[0], secondId = crypto.randomUUID()
  const a = { id: crypto.randomUUID(), size: 4, points: [[100, 100, .4], [250, 100, .8]] }
  const b = { id: crypto.randomUUID(), size: 4, points: [[100, 80, .3], [250, 80, .6]] }
  const pending = { id: first.id, width: 1000, height: 1414, strokes: [a], revision: first.revision, mutation_id: crypto.randomUUID() }
  if (acknowledged) await page.request.put(`/api/topics/${id}/ink-pages/${first.id}`, { data: pending })
  await page.request.put(`/api/topics/${id}/ink-pages/${secondId}`, { data: { ...pending, revision: 0, mutation_id: crypto.randomUUID(), strokes: [b] } })
  const newer = { id: crypto.randomUUID(), size: 4, points: [[300, 150, .5], [350, 170, .7]] }
  // Simulate an old app with a request either unsent or missing its reply,
  // plus newer edits in its IndexedDB recovery draft before this update.
  await page.evaluate(async ({ topic, pending, newer }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('verso-ink', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite')
      tx.objectStore('pages').put({ topic, id: pending.id, index: 0,
        page: { ...pending, strokes: [...pending.strokes, newer], mutation_id: crypto.randomUUID(), dirty: true, pending } })
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    }); db.close()
  }, { topic: id, pending, newer })
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  const sections = await savedPages(page, id)
  expect(sections).toHaveLength(2)
  expect(sections[0].space).toBe('canvas'); expect(sections[1].space).toBe('canvas')
  expect(sections[0].strokes).toEqual([a, newer])
  expect(sections[1].strokes[0].points).toEqual([[100, 1494, .3], [250, 1494, .6]])
  const canvas = page.getByLabel('Ink canvas', { exact: true })
  await pan(canvas, 0, 1350)
  await stroke(canvas, [[500, 1400], [500, 1440]]) // Cross the old page boundary as one stroke.
  await count(page, id, 4)
  await page.getByRole('button', { name: 'Eraser', exact: true }).click()
  await stroke(canvas, [[150, 1494], [500, 1420]]) // Erase across two storage sections.
  await count(page, id, 2)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await count(page, id, 4)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await count(page, id, 2)
  await page.reload(); await showPanel(page, isMobile)
  await expect(page.getByLabel('Ink notebook status')).toContainText('Saved on host')
  expect((await savedPages(page, id))[0].strokes).toEqual([a, newer])
})

test('image actions crop the current view or selection and reject illegible zoomed-out snapshots', async ({ page, isMobile }) => {
  const id = await openInk(page, isMobile), canvas = page.getByLabel('Ink canvas', { exact: true })
  await page.getByRole('button', { name: 'verify image support', exact: true }).click()
  await page.getByRole('button', { name: 'Save & verify images', exact: true }).click()
  await expect(page.getByText(/^Image support verified\. You can now/)).toBeVisible()
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await stroke(canvas)
  await pan(canvas, 1000, 3000)
  await stroke(canvas, [[1200, 3200], [1250, 3250]])
  await count(page, id, 2)
  const box = (await canvas.boundingBox())!
  await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -Math.log(.25) / .002, clientX: box.x, clientY: box.y })
  await expect.poll(async () => (await camera(canvas)).zoom).toBe(.25)
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Zoom in or select a smaller area')
  expect(await (await page.request.get(`/api/topics/${id}/latest-turn`)).json()).toBeNull()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await stroke(canvas, [[1180, 3180], [1270, 3270]])
  const request = page.waitForRequest(request => request.url().endsWith(`/topics/${id}/messages`))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const body = (await request).postDataJSON()
  expect(body.content).toBe('Selected handwriting')
  const captured = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode()
    const layer = document.createElement('canvas'); layer.width = image.naturalWidth; layer.height = image.naturalHeight
    const ctx = layer.getContext('2d')!; ctx.drawImage(image, 0, 0)
    return { width: layer.width, height: layer.height, center: ctx.getImageData(90, 90, 1, 1).data[0] }
  }, body.image)
  expect(captured.width).toBe(180); expect(captured.height).toBe(180); expect(captured.center).toBeLessThan(200)
})
