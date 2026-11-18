import { expect, test, type Page } from '@playwright/test'

async function openWorkspace(page: Page) {
  const topic = await (await page.request.post('/api/topics', { data: { title: 'Study layout' } })).json()
  await page.addInitScript(id => localStorage.setItem('verso.active-topic', id), topic.id)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  return topic.id as string
}

async function dragDivider(page: Page, fraction: number, touch: boolean) {
  const divider = page.getByRole('separator', { name: 'Resize conversation and notebook' })
  await divider.click({ trial: true })
  const handle = (await divider.boundingBox())!, area = (await page.locator('.workspace').boundingBox())!
  const vertical = await divider.getAttribute('aria-orientation') === 'horizontal'
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const end = vertical ? { x: start.x, y: area.y + (area.height - handle.height) * fraction + handle.height / 2 }
    : { x: area.x + (area.width - handle.width) * fraction + handle.width / 2, y: start.y }
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...start }] })
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { id: 1, x: start.x + (end.x - start.x) * i / 5, y: start.y + (end.y - start.y) * i / 5 },
    ] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach()
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up()
  }
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(fraction * 100)))
}

test('notes expand and return without losing drafts, scrolling or the sidebar preference', async ({ page }) => {
  const id = await openWorkspace(page)
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  const notes = page.getByRole('textbox', { name: 'Notebook', exact: true })
  const content = Array.from({ length: 60 }, (_, i) => `Note ${i + 1}: Keep this idea.`).join('\n')
  await draft.fill('Keep my unfinished question.')
  await notes.fill(content)
  await expect(page.getByText('✓ Saved on host')).toBeVisible()
  await notes.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = 200; element.dataset.layoutCheck = 'same-editor' })
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  const before = (await page.locator('.notebook-pane').boundingBox())!.width
  await page.getByRole('button', { name: 'Expand notebook', exact: true }).click()
  await expect(draft).toBeHidden()
  await expect(page.getByRole('separator')).toBeHidden()
  await expect(page.locator('.sidebar')).toBeHidden()
  await expect.poll(async () => (await page.locator('.notebook-pane').boundingBox())!.width).toBeGreaterThan(before * 1.5)
  await expect(notes).toHaveValue(content)
  await expect(notes).toHaveAttribute('data-layout-check', 'same-editor')
  expect(await notes.evaluate(element => element.scrollTop)).toBeCloseTo(200)
  await notes.press('ControlOrMeta+End'); await notes.press('Enter'); await notes.pressSequentially('Added while focused.')
  await page.getByRole('button', { name: 'Show split view', exact: true }).click()
  await expect(page.getByRole('separator')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible()
  await expect(draft).toHaveValue('Keep my unfinished question.')
  await expect(notes).toHaveValue(`${content}\nAdded while focused.`)
  await expect(notes).toHaveAttribute('data-layout-check', 'same-editor')
  await expect(page.getByText('✓ Saved on host')).toBeVisible()
  expect((await (await page.request.get(`/api/topics/${id}/notebook`)).json()).markdown).toBe(`${content}\nAdded while focused.`)
})

test('split panes rotate, resize by pointer and keyboard, and remember each orientation independently', async ({ page, isMobile }) => {
  await openWorkspace(page)
  const divider = page.getByRole('separator', { name: 'Resize conversation and notebook' })
  const chat = page.locator('.conversation-pane'), notes = page.locator('.notebook-pane')
  await expect(divider).toHaveAttribute('aria-orientation', 'vertical')
  expect((await chat.boundingBox())!.x).toBeLessThan((await notes.boundingBox())!.x)
  expect((await chat.boundingBox())!.y).toBeCloseTo((await notes.boundingBox())!.y)
  await dragDivider(page, .62, isMobile)
  await divider.press('ArrowLeft')
  await expect(divider).toHaveAttribute('aria-valuenow', '60')
  await page.setViewportSize({ width: 800, height: 1280 })
  await expect(divider).toHaveAttribute('aria-orientation', 'horizontal')
  await divider.click({ trial: true }) // Let the sidebar's width transition finish after rotation.
  expect((await chat.boundingBox())!.y).toBeLessThan((await notes.boundingBox())!.y)
  expect((await chat.boundingBox())!.x).toBeCloseTo((await notes.boundingBox())!.x)
  await dragDivider(page, .35, isMobile)
  await divider.press('ArrowDown')
  await expect(divider).toHaveAttribute('aria-valuenow', '37')
  await divider.press('End')
  expect(await divider.getAttribute('aria-valuenow')).toBe(await divider.getAttribute('aria-valuemax'))
  expect((await notes.boundingBox())!.height).toBeGreaterThanOrEqual(239)
  await divider.press('Home')
  expect(await divider.getAttribute('aria-valuenow')).toBe(await divider.getAttribute('aria-valuemin'))
  expect((await chat.boundingBox())!.height).toBeGreaterThanOrEqual(159)
  await divider.press('Enter')
  await expect(divider).toHaveAttribute('aria-valuenow', '50')
  await dragDivider(page, .35, isMobile)
  await page.screenshot({ path: `test-results/layout-portrait-${isMobile ? 'touch' : 'mouse'}.png` })
  await page.reload()
  await expect(divider).toHaveAttribute('aria-valuenow', '35')
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(divider).toHaveAttribute('aria-orientation', 'vertical')
  await expect(divider).toHaveAttribute('aria-valuenow', '60')
  await page.getByRole('button', { name: 'Expand notebook', exact: true }).click()
  await page.getByRole('button', { name: 'Show split view', exact: true }).click()
  await expect(divider).toHaveAttribute('aria-valuenow', '60')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBeTruthy()
})

test('a notebook action brings back both panes and resizing preserves a streaming conversation', async ({ page, isMobile }) => {
  await openWorkspace(page)
  await page.setViewportSize({ width: 800, height: 1280 })
  const notes = page.getByRole('textbox', { name: 'Notebook', exact: true })
  await notes.fill('A covector maps a vector to a scalar.')
  await page.getByRole('button', { name: 'Expand notebook', exact: true }).click()
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await expect(page.getByRole('separator')).toBeVisible()
  await expect(notes).toBeVisible()
  await expect(page.locator('.diary-response')).toHaveText('Consider how this idea connects to linearity.')
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await expect(draft).toBeEnabled()
  await draft.fill('long-response'); await draft.press('Enter')
  await expect(page.getByText(/^Paragraph 1\./)).toBeVisible()
  await dragDivider(page, .3, isMobile)
  await page.getByRole('button', { name: 'Expand notebook', exact: true }).click()
  await notes.fill('I can keep writing while the conversation is hidden.')
  await page.getByRole('button', { name: 'Show split view', exact: true }).click()
  await expect(draft).toBeEnabled()
  await expect(page.locator('.diary-response')).toContainText('Paragraph 30.')
  await expect(notes).toHaveValue('I can keep writing while the conversation is hidden.')
  await page.screenshot({ path: `test-results/layout-study-${isMobile ? 'touch' : 'mouse'}.png` })
})
