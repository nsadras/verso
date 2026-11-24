import { expect, test, type Page, type Locator } from '@playwright/test'

const initial = '# Existing notes\n\nMy original wording and $x^2$.  \n'
const convert = (page: Page) => page.getByRole('button', { name: 'Convert handwriting to Markdown', exact: true })
const notice = (page: Page) => page.getByLabel('Handwriting conversion').filter({ visible: true })
async function notes(page: Page, id: string) { return (await page.request.get(`/api/topics/${id}/notebook`)).json() }
async function ink(page: Page, id: string) { return (await page.request.get(`/api/topics/${id}/ink-pages`)).json() }
async function showNotes(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('navigation', { name: 'Workspace panel' }).getByRole('button', { name: 'Notebook', exact: true }).click()
}
async function open(page: Page, mobile: boolean, model = 'conversion-normal', multiple = false) {
  const { id } = await (await page.request.post('/api/topics', { data: { title: 'Conversion notes' } })).json()
  await page.request.put('/api/settings', { data: { model, context_window: 8192 } })
  expect((await page.request.post('/api/settings/test-vision')).ok()).toBe(true)
  await page.request.put(`/api/topics/${id}/notebook`, { data: { markdown: initial, revision: 0 } })
  const points = multiple ? [[100, 100], [-1900, 6000], [1800, 100]] : [[100, 100]]
  await page.request.put(`/api/topics/${id}/ink-pages/${crypto.randomUUID()}`, { data: {
    width: 1000, height: 1414, space: 'canvas', revision: 0, mutation_id: crypto.randomUUID(),
    strokes: points.map(([x, y]) => ({ id: crypto.randomUUID(), size: 4, points: [[x, y, .7], [x + 40, y + 70, .7], [x + 80, y + 10, .7]] })),
  } })
  await page.request.post(`/api/topics/${id}/messages`, { data: { content: 'Earlier discussion' } })
  await page.addInitScript(id => { localStorage.setItem('verso.active-topic', id); localStorage.setItem('verso.notebook-view', 'ink') }, id)
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  if (mobile) await page.getByRole('navigation', { name: 'Workspace panel' }).getByRole('button', { name: 'Chat', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('An unfinished question')
  await showNotes(page, mobile)
  await expect(convert(page)).toBeEnabled()
  return id as string
}
async function gesture(canvas: Locator, points: number[][]) {
  await canvas.click({ trial: true })
  await expect.poll(() => canvas.evaluate(node => Math.abs(Number(node.dataset.scale)
    - node.getBoundingClientRect().width / 1000 * Number(node.dataset.zoom)))).toBeLessThan(.0001)
  const events = await canvas.evaluate((node, points) => {
    const box = node.getBoundingClientRect(), scale = Number(node.dataset.scale)
    return points.map(([x, y]) => ({ pointerType: 'pen', pointerId: 9, button: 0, buttons: 1, pressure: .7,
      clientX: box.x + (x - Number(node.dataset.viewX)) * scale, clientY: box.y + (y - Number(node.dataset.viewY)) * scale }))
  }, points)
  await canvas.dispatchEvent('pointerdown', events[0])
  for (const event of events.slice(1)) await canvas.dispatchEvent('pointermove', event)
  await canvas.dispatchEvent('pointerup', { ...events[events.length - 1], buttons: 0 })
}

test('selection converts to appended Markdown with rendered math, preserving ink and conversation', async ({ page, isMobile }) => {
  const id = await open(page, isMobile, 'conversion-normal', true)
  const beforeInk = await ink(page, id), beforeChat = await (await page.request.get(`/api/topics/${id}/latest-turn`)).json()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await gesture(page.getByLabel('Ink canvas', { exact: true }), [[80, 80], [200, 190]])
  await expect(convert(page)).toHaveText('Convert')
  const request = page.waitForRequest(request => request.url().endsWith(`/topics/${id}/transcribe`))
  await convert(page).click()
  const image = (await request).postDataJSON().image
  const size = await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode(); return [image.width, image.height] }, image)
  expect(size[0]).toBeLessThanOrEqual(240); expect(size[1]).toBeLessThanOrEqual(220)
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.notebook-preview .katex-display')).toBeVisible()
  await expect(page.locator('.notebook-preview')).not.toContainText('verso:handwriting:')
  await expect(page.getByRole('heading', { name: /^Converted handwriting/ })).toBeVisible()
  const saved = await notes(page, id)
  expect(saved.markdown).toMatch(/^# Existing notes/)
  expect(saved.markdown.startsWith(initial + '\n\n---\n\n')).toBe(true)
  expect(saved.markdown).toContain('*Source: selection.*')
  expect(saved.markdown).toContain('$$\ne^{i\\pi}+1=0\n$$')
  expect(saved.markdown).toMatch(/<!-- verso:handwriting:.*:begin -->/)
  expect(saved.markdown).toMatch(/<!-- verso:handwriting:.*:end -->/)
  expect(await ink(page, id)).toEqual(beforeInk)
  expect(await (await page.request.get(`/api/topics/${id}/latest-turn`)).json()).toEqual(beforeChat)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Notebook', exact: true })).toHaveValue(saved.markdown)
  if (isMobile) await page.getByRole('navigation', { name: 'Workspace panel' }).getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('An unfinished question')
  await page.reload(); await showNotes(page, isMobile)
  // The test's init script deliberately reopens Ink on reload.
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Notebook', exact: true })).toHaveValue(saved.markdown)
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await page.screenshot({ path: `test-results/conversion-${isMobile ? 'mobile' : 'desktop'}.png` })
})

test('whole notebook includes offscreen ink and preserves text and ink written while converting', async ({ page, isMobile }) => {
  const id = await open(page, isMobile, 'conversion-normal', true)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const images: string[] = []
  await page.route(`**/topics/${id}/transcribe`, async route => {
    images.push(route.request().postDataJSON().image)
    if (images.length === 1) await gate
    await route.continue()
  })
  await expect(convert(page)).toHaveText('Convert all')
  await convert(page).click()
  await expect.poll(() => images.length).toBe(1)
  await expect(notice(page)).toContainText('Converting notebook')
  await gesture(page.getByLabel('Ink canvas', { exact: true }), [[500, 150], [550, 220]])
  await expect.poll(async () => (await ink(page, id))[0].strokes.length).toBe(4)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByRole('textbox', { name: 'Notebook', exact: true }).fill(initial + '\nWritten while converting.')
  await expect(page.getByLabel('Notebook status', { exact: true })).toContainText('Saved on host')
  release()
  await expect(page.locator('.notebook-preview')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  expect(images).toHaveLength(3)
  const saved = await notes(page, id)
  expect(saved.markdown.startsWith(initial + '\nWritten while converting.')).toBe(true)
  expect(saved.markdown.match(/# Euler’s identity/g)).toHaveLength(3)
  expect(saved.markdown.match(/:begin -->/g)).toHaveLength(1)
  expect(saved.markdown).toContain('*Source: notebook.*')
  expect((await ink(page, id))[0].strokes).toHaveLength(4)
})

test('finishing a conversion waits for an active pen stroke before revealing Text', async ({ page, isMobile }) => {
  const id = await open(page, isMobile)
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/topics/${id}/transcribe`, async route => { started = true; await gate; await route.continue() })
  await convert(page).click()
  await expect.poll(() => started).toBe(true)
  const canvas = page.getByLabel('Ink canvas', { exact: true })
  await canvas.click({ trial: true })
  const box = (await canvas.boundingBox())!, scale = Number(await canvas.getAttribute('data-scale'))
  const pointer = (x: number, y: number, buttons = 1) => ({ pointerType: 'pen', pointerId: 81, button: 0, buttons, pressure: .7,
    clientX: box.x + x * scale, clientY: box.y + y * scale })
  await canvas.dispatchEvent('pointerdown', pointer(300, 300))
  await canvas.dispatchEvent('pointermove', pointer(340, 360))
  release()
  await expect.poll(async () => (await notes(page, id)).revision).toBe(2)
  await expect(canvas).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ink', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await canvas.boundingBox())!.y).toBeCloseTo(box.y)
  await canvas.dispatchEvent('pointerup', pointer(360, 380, 0))
  await expect(page.locator('.notebook-preview')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  await expect.poll(async () => (await ink(page, id))[0].strokes.length).toBe(2)
  const strokes = (await ink(page, id))[0].strokes
  expect(strokes[1].points.at(-1)[0]).toBeCloseTo(360)
  expect(strokes[1].points.at(-1)[1]).toBeCloseTo(380)
})

test('a later section failure appends nothing and allows a fresh conversion', async ({ page, isMobile }) => {
  const id = await open(page, isMobile, 'conversion-normal', true)
  let calls = 0
  await page.route(`**/topics/${id}/transcribe`, async route => {
    calls++
    if (calls === 2) await route.fulfill({ status: 502, json: { detail: 'This section could not be read.' } })
    else await route.continue()
  })
  await convert(page).click()
  await expect(notice(page)).toContainText('This section could not be read.')
  expect(calls).toBe(2)
  expect(await notes(page, id)).toEqual({ markdown: initial, revision: 1 })
  await expect(notice(page).getByRole('button', { name: 'Retry append' })).toHaveCount(0)
  await expect(convert(page)).toBeEnabled()
  await page.unroute(`**/topics/${id}/transcribe`)
  await convert(page).click()
  await expect(page.locator('.notebook-preview')).toBeVisible()
})

test('cancelling or truncating a conversion never appends partial text', async ({ page, isMobile }) => {
  const id = await open(page, isMobile, 'conversion-slow')
  await convert(page).click()
  await expect(notice(page).getByRole('button', { name: 'Cancel conversion' })).toBeVisible()
  await notice(page).getByRole('button', { name: 'Cancel conversion' }).click()
  await expect(convert(page)).toBeEnabled()
  expect(await notes(page, id)).toEqual({ markdown: initial, revision: 1 })
  // A settings write becomes available only after cancellation also reaches the host.
  await expect.poll(async () => (await page.request.put('/api/settings', { data: { model: 'conversion-limit' } })).status()).toBe(200)
  await page.request.post('/api/settings/test-vision')
  await page.reload(); await showNotes(page, isMobile)
  await convert(page).click()
  await expect(notice(page)).toContainText('limit before finishing')
  expect(await notes(page, id)).toEqual({ markdown: initial, revision: 1 })
})

test('a lost append acknowledgement recovers after refresh without duplicate text', async ({ page, isMobile }) => {
  const id = await open(page, isMobile)
  await page.route(`**/topics/${id}/notebook/append-conversion`, async route => { await route.fetch(); await route.abort('failed') })
  await convert(page).click()
  await expect(notice(page).getByRole('button', { name: 'Retry append' })).toBeVisible()
  const saved = await notes(page, id)
  expect(saved.revision).toBe(2)
  expect(saved.markdown.match(/:begin -->/g)).toHaveLength(1)
  await page.reload(); await showNotes(page, isMobile)
  await expect(notice(page).getByRole('button', { name: 'Retry append' })).toBeVisible()
  await expect(convert(page)).toBeDisabled()
  const download = page.waitForEvent('download')
  await notice(page).getByRole('button', { name: 'Download Markdown' }).click()
  expect((await download).suggestedFilename()).toMatch(/converted.md$/)
  await page.unroute(`**/topics/${id}/notebook/append-conversion`)
  await notice(page).getByRole('button', { name: 'Retry append' }).click()
  await expect(notice(page)).toHaveCount(0)
  expect(await notes(page, id)).toEqual(saved)
  await expect(page.locator('.notebook-preview .katex-display')).toBeVisible()
})

test('text save conflicts retain the draft and completed conversion until explicitly resolved', async ({ page, isMobile }) => {
  const id = await open(page, isMobile)
  await page.request.put(`/api/topics/${id}/notebook`, { data: { markdown: 'Notes from another device', revision: 1 } })
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Notebook', exact: true })
  await editor.fill('My local text edits')
  await expect(page.getByRole('button', { name: 'Export my draft' })).toBeVisible()
  await page.getByRole('button', { name: 'Ink', exact: true }).click()
  await convert(page).click()
  await expect(notice(page)).toContainText('Save or resolve your text notebook edits')
  expect((await notes(page, id)).markdown).toBe('Notes from another device')
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(editor).toHaveValue('My local text edits')
  await expect(notice(page).getByRole('button', { name: 'Download Markdown' })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Reload saved version' }).click()
  await expect(editor).toHaveValue('Notes from another device')
  await notice(page).getByRole('button', { name: 'Retry append' }).click()
  await expect(notice(page)).toHaveCount(0)
  expect((await notes(page, id)).markdown).toMatch(/^Notes from another device\n\n---/)
})
