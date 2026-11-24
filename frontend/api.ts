export type Topic = { id: string; title: string; created_at: string; updated_at: string }
export type NotebookData = { markdown: string; revision: number }
export type ConversionDraft = { id: string; markdown: string; scope: 'notebook' | 'selection' }
export type ConversionAppend = NotebookData & { heading: string; appended: boolean }
export const NOTEBOOK_ACTIONS = { explore: 'Explore', check: 'Check', test_me: 'Test Me' } as const
export type NotebookAction = keyof typeof NOTEBOOK_ACTIONS
export type LatestTurn = {
  image?: string
  user_text: string
  assistant_text: string
  status: 'running' | 'complete' | 'cancelled' | 'failed' | 'interrupted'
  action: NotebookAction | null
}
export type Settings = {
  vision_verified: boolean
  mode: 'local' | 'cloud'
  provider: 'openai' | 'anthropic' | 'gemini'
  endpoint: string
  model: string
  context_window: number
  max_output_tokens: number | null
  key_source: string
  keyring_available: boolean
}
export type StreamEvent =
  | { type: 'start'; generation_id: string; omitted_turns: number }
  | { type: 'delta'; text: string }
  | { type: 'transcription'; markdown: string }
  | { type: 'error'; message: string }
  | { type: 'done'; status: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function checked(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(response.status, typeof body.detail === 'string' ? body.detail : 'The request failed. Please try again.')
  }
  return response
}

export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await checked(await fetch(`/api${path}`, {
    method, signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  return response.status === 204 ? undefined as T : response.json()
}

export async function streamMessage(topic: string, content: string, signal: AbortSignal, onEvent: (event: StreamEvent) => void, action?: NotebookAction, image?: string) {
  const response = await checked(await fetch(`/api/topics/${topic}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, action, image }), signal,
  }))
  await readEvents(response, onEvent)
}

export async function transcribeInk(topic: string, image: string, signal: AbortSignal): Promise<string> {
  const response = await checked(await fetch(`/api/topics/${topic}/transcribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal,
  }))
  let markdown = '', status = '', error = ''
  await readEvents(response, event => {
    if (event.type === 'transcription') markdown = event.markdown
    if (event.type === 'error') error = event.message
    if (event.type === 'done') status = event.status
  })
  if (status !== 'complete' || !markdown.trim()) throw new Error(error || 'The conversion did not finish. Nothing was appended.')
  return markdown
}

async function readEvents(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.body) throw new Error('Streaming is unavailable in this browser.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', completed = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue
        const event: StreamEvent = JSON.parse(frame.slice(6))
        onEvent(event)
        if (event.type === 'done') completed = true
      }
      if (done) break
    }
    if (!completed) throw new Error('Connection lost before the response finished. You can try your message again.')
  } finally { reader.releaseLock() }
}

export function errorMessage(error: unknown) {
  return error instanceof TypeError ? 'Cannot reach the app. Check your connection to the host.'
    : error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function downloadMarkdown(title: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'notebook'}.md`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
