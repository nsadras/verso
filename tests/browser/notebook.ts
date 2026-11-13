import type { Page } from '@playwright/test'

export async function notebookOption(page: Page, name: 'Preview' | 'Edit') {
  await page.getByRole('button', { name, exact: true }).click()
}
