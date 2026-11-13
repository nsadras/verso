import { expect, test, type Page } from '@playwright/test'
import { notebookOption } from './notebook'

const passage = 'A covector maps a vector to a scalar.'
const notes = `# My understanding\n\n${passage}\n\nKeep this other note private.`

async function openNotebook(page: Page, source = notes) {
  const topic = await (await page.request.post('/api/topics', { data: { title: 'Contextual actions' } })).json()
  await page.request.put(`/api/topics/${topic.id}/notebook`, { data: { markdown: source, revision: 0 } })
  await page.addInitScript(id => localStorage.setItem('verso.active-topic', id), topic.id)
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  return topic.id as string
}

async function showPanel(page: Page, name: 'Notebook' | 'Chat', mobile: boolean) {
  if (mobile) await page.getByRole('navigation', { name: 'Workspace panel' }).getByRole('button', { name, exact: true }).click()
}

async function selectPassage(page: Page, selected = passage) {
  await page.getByRole('textbox', { name: 'Notebook', exact: true }).evaluate((element: HTMLTextAreaElement, text) => {
    element.focus()
    const start = element.value.indexOf(text)
    element.setSelectionRange(start, start + text.length)
  }, selected)
  await expect(page.getByText('selection', { exact: true })).toBeVisible()
}

for (const [action, label, reply] of [
  ['explore', 'Explore', 'Consider how this idea connects to linearity.'],
  ['check', 'Check', 'This is accurate, with one qualification: the map must be linear.'],
  ['test_me', 'Test Me', 'How would doubling the input change the output, and why?'],
]) {
  test(`${label} shares the selection, preserves the draft, and survives reload`, async ({ page, isMobile }) => {
    const id = await openNotebook(page)
    const draft = page.getByRole('textbox', { name: 'Message', exact: true })
    await draft.fill('Keep my unfinished thought.')
    await showPanel(page, 'Notebook', isMobile)
    await selectPassage(page)
    const request = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith(`/topics/${id}/messages`))
    const actionButton = page.getByRole('button', { name: label, exact: true })
    if (isMobile) await actionButton.tap()
    else await actionButton.click()
    expect((await request).postDataJSON()).toEqual({ content: passage, action })
    await expect(page.locator('.diary-action')).toHaveText(label)
    await expect(page.locator('blockquote.diary-user')).toHaveText(passage)
    await expect(page.locator('.diary-response')).toHaveText(reply)
    await expect(draft).toBeEnabled()
    await expect(draft).toHaveValue('Keep my unfinished thought.')
    await showPanel(page, 'Notebook', isMobile)
    await expect(page.getByRole('group', { name: 'Notebook actions' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Notebook', exact: true })).toHaveValue(notes)
    expect((await (await page.request.get(`/api/topics/${id}/notebook`)).json()).markdown).toBe(notes)
    await page.reload()
    await expect(page.locator('.diary-action')).toHaveText(label)
    await expect(page.locator('blockquote.diary-user')).toHaveText(passage)
    await expect(page.locator('.diary-response')).toHaveText(reply)
    if (action === 'explore') await page.screenshot({ path: `test-results/action-quote-${isMobile ? 'mobile' : 'desktop'}.png` })
    await draft.fill(action === 'test_me' ? 'my reasoning' : 'A follow-up')
    await draft.press('Enter')
    await expect(page.locator('.diary-action')).toHaveCount(0)
    await expect(page.locator('blockquote.diary-user')).toHaveCount(0)
    await expect(page.locator('.diary-response')).toHaveText(action === 'test_me'
      ? 'Your reasoning uses linearity: doubling the input doubles the output.' : 'A response to: A follow-up')
    await expect(draft).toBeEnabled()
  })

  test(`${label} uses the whole notebook without a selection in Edit and Preview`, async ({ page, isMobile }) => {
    const id = await openNotebook(page)
    for (const preview of [false, true]) {
      await showPanel(page, 'Notebook', isMobile)
      if (preview) await notebookOption(page, 'Preview')
      await expect(page.getByText('notebook', { exact: true })).toBeVisible()
      const request = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith(`/topics/${id}/messages`))
      const actionButton = page.getByRole('button', { name: label, exact: true })
      if (isMobile) await actionButton.tap()
      else await actionButton.click()
      expect((await request).postDataJSON()).toEqual({ content: notes, action })
      await expect(page.locator('blockquote.diary-user')).toHaveText(notes)
      await expect(page.locator('.diary-response')).toHaveText(reply)
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    }
  })
}

test('header actions preserve selection with mouse, touch, and keyboard access', async ({ page, isMobile }) => {
  await openNotebook(page)
  await showPanel(page, 'Notebook', isMobile)
  await notebookOption(page, 'Preview')
  const paragraph = page.locator('.notebook-preview p').first()
  await paragraph.selectText()
  const toolbar = page.getByRole('group', { name: 'Notebook actions' })
  await expect(toolbar).toBeVisible()
  await expect(page.getByText('selection', { exact: true })).toBeVisible()
  const box = (await toolbar.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: `test-results/notebook-actions-${isMobile ? 'mobile' : 'desktop'}.png` })
  await page.keyboard.press('Escape')
  await expect(page.getByText('notebook', { exact: true })).toBeVisible()
  await notebookOption(page, 'Edit')
  const notebook = page.getByRole('textbox', { name: 'Notebook', exact: true })
  await notebook.focus()
  await notebook.press('ControlOrMeta+Home')
  await notebook.press('ControlOrMeta+Shift+End')
  await expect(toolbar).toBeVisible()
  await notebook.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeFocused()
  await expect(page.getByText('selection', { exact: true })).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Test Me', exact: true })).toBeFocused()
  await expect(page.getByText('selection', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('notebook', { exact: true })).toBeVisible()
  await expect(notebook).toBeFocused()
  // Exercise rendered text submission as well as source selection.
  await notebookOption(page, 'Preview')
  await paragraph.selectText()
  const request = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/messages'))
  await page.getByRole('button', { name: 'Check', exact: true }).focus()
  await page.keyboard.press('Enter')
  expect((await request).postDataJSON()).toEqual({ content: passage, action: 'check' })
  await expect(page.locator('.diary-user')).toHaveText(passage)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
})

test('actions can be stopped or retried without changing notes or submitting a second response', async ({ page, isMobile }) => {
  await openNotebook(page, 'slow')
  await showPanel(page, 'Notebook', isMobile)
  await selectPassage(page, 'slow')
  await page.getByRole('button', { name: 'Test Me', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible()
  await showPanel(page, 'Notebook', isMobile)
  const notebook = page.getByRole('textbox', { name: 'Notebook', exact: true })
  await notebook.fill('I can still write while the model thinks.')
  await notebook.selectText()
  for (const label of ['Explore', 'Check', 'Test Me']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled()
  }
  await expect(page.getByText('✓ Saved on host')).toBeVisible()
  await showPanel(page, 'Chat', isMobile)
  await page.getByRole('button', { name: 'Stop response', exact: true }).click()
  await expect(page.getByText('Response stopped.', { exact: false })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await showPanel(page, 'Notebook', isMobile)
  await notebook.fill(passage)
  await selectPassage(page)
  await page.route('**/api/topics/*/messages', route => route.fulfill({ status: 503, json: { detail: 'Try again shortly.' } }), { times: 1 })
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Try again shortly.')
  const request = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/messages'))
  await page.getByRole('button', { name: 'Try Explore again', exact: true }).click()
  expect((await request).postDataJSON()).toEqual({ content: passage, action: 'explore' })
  await expect(page.locator('.diary-response')).toHaveText('Consider how this idea connects to linearity.')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await showPanel(page, 'Notebook', isMobile)
  await expect(notebook).toHaveValue(passage)
})

test('empty notebooks disable actions and clearing a selection uses the current draft', async ({ page, isMobile }) => {
  await openNotebook(page, '')
  await showPanel(page, 'Notebook', isMobile)
  for (const label of ['Explore', 'Check', 'Test Me']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled()
  }
  const notebook = page.getByRole('textbox', { name: 'Notebook', exact: true })
  await notebook.fill(notes)
  await selectPassage(page)
  await notebook.press('ArrowRight')
  await expect(page.getByText('notebook', { exact: true })).toBeVisible()
  const draft = `${notes}\n\nA new unsaved thought.`
  await notebook.fill(draft)
  const request = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/messages'))
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  expect((await request).postDataJSON()).toEqual({ content: draft, action: 'explore' })
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await showPanel(page, 'Notebook', isMobile)
  await expect(notebook).toHaveValue(draft)
})

test('the notebook keeps four inline controls and a quiet footer in Edit and Preview', async ({ page, isMobile }) => {
  await openNotebook(page)
  await showPanel(page, 'Notebook', isMobile)
  const preview = page.getByRole('button', { name: 'Preview', exact: true })
  const notebook = page.getByRole('textbox', { name: 'Notebook', exact: true })
  const footer = page.locator('.notebook-status')
  await expect(preview).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export .md', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Notebook options', exact: true })).toHaveCount(0)
  await expect(footer).toContainText('✓ Saved on host')
  await expect(footer).toContainText('16 words')
  await expect(footer).toContainText('notebook')
  await expect(footer).toHaveCSS('border-top-width', '0px')
  expect((await footer.boundingBox())!.height).toBeLessThan(32)
  const header = (await page.locator('.notebook-heading').boundingBox())!
  expect(header.height).toBeLessThan(50)
  const previewBounds = (await preview.boundingBox())!
  for (const name of ['Explore', 'Check', 'Test Me', 'Preview']) {
    const bounds = (await page.getByRole('button', { name, exact: true }).boundingBox())!
    expect(Math.abs(bounds.y - previewBounds.y)).toBeLessThan(1)
    expect(bounds.y).toBeGreaterThanOrEqual(header.y)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(header.y + header.height)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(header.x + header.width)
  }
  await selectPassage(page)
  await expect(footer).toContainText('selection')
  await notebook.press('Shift+Tab')
  await expect(preview).toBeFocused()
  await expect(footer).toContainText('selection')
  await preview.press('Enter')
  await expect(page.locator('.notebook-preview')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(footer).toContainText('notebook')
  expect((await footer.boundingBox())!.height).toBeLessThan(32)
  await page.screenshot({ path: `test-results/notebook-footer-${isMobile ? 'mobile' : 'desktop'}.png` })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(notebook).toHaveValue(notes)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
