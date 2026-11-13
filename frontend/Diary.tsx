import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Markdown } from './Markdown'
import { NOTEBOOK_ACTIONS, type NotebookAction } from './api'

export type DiaryHandle = {
  advancePage: (signal: AbortSignal, fromNotebook?: boolean) => Promise<void>
  focusDraft: () => void
}

type DiaryProps = {
  page: number
  input: string
  question: string
  answer: string
  action: NotebookAction | null
  running: boolean
  disabled: boolean
  error: string
  result: string
  omitted: number
  onInput: (value: string) => void
  onSend: () => void
  onStop: () => void
  onRetryAction: () => void
}

export const Diary = forwardRef<DiaryHandle, DiaryProps>(function Diary({
  page, input, question, answer, action, running, disabled, error, result, omitted, onInput, onSend, onStop, onRetryAction,
}, ref) {
  const surface = useRef<HTMLDivElement>(null)
  const paper = useRef<HTMLDivElement>(null)
  const exchange = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true)
  const previousPage = useRef(page)
  const wasRunning = useRef(false)
  const transition = useRef<{ animations: Animation[]; scrollTop: number } | null>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  function updateScrollHint() {
    const scroll = surface.current
    setMoreBelow(!!scroll?.clientHeight && !transition.current &&
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 8)
  }

  function scrollDown() {
    const scroll = surface.current
    if (!scroll) return
    scroll.focus({ preventScroll: true })
    scroll.scrollBy({
      top: scroll.clientHeight * 0.8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  function finishTransition(restoreScroll = false) {
    const active = transition.current
    if (!active) return
    active.animations.forEach(animation => animation.cancel())
    if (paper.current) paper.current.style.paddingTop = ''
    if (surface.current) {
      surface.current.style.overflowY = ''
      surface.current.removeAttribute('data-advancing')
      surface.current.scrollTop = restoreScroll ? active.scrollTop : 0
    }
    transition.current = null
  }

  function fitEditor() {
    const element = editor.current
    if (!element || !element.clientWidth) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }

  function focusDraft() {
    const active = document.activeElement
    requestAnimationFrame(() => {
      // A selection made before the next frame takes priority over queued focus.
      if (document.activeElement === active) editor.current?.focus({ preventScroll: true })
    })
  }

  function focusFromPage(event: MouseEvent<HTMLElement>) {
    if (disabled || running) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('a, button, input, select, textarea, [contenteditable], .diary-exchange, .diary-feedback')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    // Focus during the click so touch browsers can open the keyboard and reveal the caret.
    editor.current?.focus()
  }

  useImperativeHandle(ref, () => ({
    focusDraft,
    async advancePage(signal, fromNotebook = false) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      const scroll = surface.current, pageElement = paper.current, draft = editor.current
      if (!scroll || !pageElement || !draft || !scroll.clientHeight ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Move the existing writing into its next position. On commit, replace the
      // draft with identical ink at this anchor, then remove the transform before paint.
      const pageStyle = getComputedStyle(pageElement)
      const padding = parseFloat(pageStyle.getPropertyValue('--page-padding'))
      const distance = fromNotebook ? 24 : draft.getBoundingClientRect().top - scroll.getBoundingClientRect().top - padding
      const scrollTop = scroll.scrollTop
      pageElement.style.paddingTop = pageStyle.paddingTop
      scroll.style.overflowY = 'hidden'
      scroll.setAttribute('data-advancing', 'true')
      setMoreBelow(false)
      const movement = pageElement.animate(
        [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-distance}px)`, opacity: fromNotebook ? 0 : 1 }],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
      )
      const animations = [movement]
      if (exchange.current) animations.push(exchange.current.animate(
        [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 1 }],
        { duration: 420, easing: 'linear', fill: 'forwards' },
      ))
      transition.current = { animations, scrollTop }
      const cancel = () => finishTransition(true)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await movement.finished
        // Keep the draft in place until React commits the refreshed exchange.
      } finally {
        signal.removeEventListener('abort', cancel)
        if (signal.aborted) finishTransition(true)
      }
    },
  }))

  useLayoutEffect(() => {
    fitEditor()
    const element = editor.current, scroll = surface.current
    if (element && scroll && document.activeElement === element && element.selectionEnd === input.length) {
      const bottom = element.getBoundingClientRect().bottom
      const visibleBottom = scroll.getBoundingClientRect().bottom - 24
      if (bottom > visibleBottom) scroll.scrollTop += bottom - visibleBottom
    }
  }, [input])

  useLayoutEffect(() => {
    if (!surface.current) return
    const resize = () => {
      if (transition.current || !surface.current?.clientHeight) return
      paper.current?.style.setProperty('--surface-height', `${surface.current.clientHeight}px`)
      fitEditor()
    }
    resize()
    const observer = new ResizeObserver(entries => {
      if (entries.some(entry => entry.target === surface.current)) resize()
      updateScrollHint()
    })
    observer.observe(surface.current)
    if (paper.current) observer.observe(paper.current)
    return () => { observer.disconnect(); finishTransition() }
  }, [])

  useLayoutEffect(() => {
    if (!surface.current) return
    if (page !== previousPage.current) {
      finishTransition()
      surface.current.scrollTop = 0
      paper.current?.style.setProperty('--surface-height', `${surface.current.clientHeight}px`)
      follow.current = true
      previousPage.current = page
    } else if (running && follow.current && !transition.current) {
      surface.current.scrollTop = surface.current.scrollHeight
    }
    updateScrollHint()
  }, [answer, page, running])

  useEffect(() => {
    const active = document.activeElement
    const stillOnPage = active === document.body || !!(active && surface.current?.contains(active))
    if (!disabled && !running && stillOnPage && (wasRunning.current || !question)) focusDraft()
    wasRunning.current = running
  }, [running, disabled, question])

  return <section className="conversation panel" aria-label="Conversation" onClick={focusFromPage}>
    <div id="conversation-page" className="diary-surface" ref={surface}
      role="region" aria-label="Conversation page" tabIndex={0} onScroll={event => {
      if (transition.current) return
      const element = event.currentTarget
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      updateScrollHint()
    }}>
      <div className={`diary-page${!question ? ' is-blank' : ''}`} ref={paper}>
        {question && <div className="diary-exchange" key={page} ref={exchange}>
          {action ? <>
            <p className="diary-action"><strong>{NOTEBOOK_ACTIONS[action]}</strong></p>
            <blockquote className="diary-user diary-quotation">{question}</blockquote>
          </> : <p className="diary-user">{question}</p>}
          <div className="markdown diary-response" aria-busy={running}>
            <Markdown>{answer}</Markdown>
          </div>
        </div>}
        <form className={`diary-writing${running && !input ? ' is-waiting' : ''}`} onSubmit={event => { event.preventDefault(); onSend() }}>
          <label className="sr-only" htmlFor="message">Message</label>
          <textarea id="message" className="diary-editor" ref={editor} value={input}
            rows={1} spellCheck disabled={disabled || running}
            onChange={event => onInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onSend()
              }
            }} />
          <span className="sr-only" role="status">{running ? (answer ? 'Writing a response…' : 'Thinking…') : ''}</span>
          {running && <button type="button" className="diary-activity" onClick={onStop}
            aria-label="Stop response" title="Stop response" />}
        </form>
        {result === 'cancelled' && <p className="diary-feedback">Response stopped. This partial exchange won’t be used as future context.</p>}
        {result === 'interrupted' && <p className="diary-feedback">This response was interrupted. Its saved text is shown above.</p>}
        {result === 'running' && !running && <p className="diary-feedback">This is a saved partial response. Refresh to check for updates.</p>}
        {error && <div className="diary-feedback error" role="alert">
          <p>{error}</p>
          {action ? <button disabled={running || disabled} onClick={onRetryAction}>Try {NOTEBOOK_ACTIONS[action]} again</button>
            : <button onClick={() => { onInput(question); focusDraft() }}>Use this message again</button>}
        </div>}
        {omitted > 0 && <p className="diary-feedback">{omitted} older {omitted === 1 ? 'exchange is' : 'exchanges are'} saved but outside the model’s current context.</p>}
      </div>
    </div>
    {moreBelow && <button type="button" className="diary-more" onClick={scrollDown}
      aria-label="Scroll down" aria-controls="conversation-page" title="More below">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>}
  </section>
})
