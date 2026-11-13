import { useEffect, useRef, useState, type RefObject } from 'react'
import { NOTEBOOK_ACTIONS, type NotebookAction } from './api'

type Props = {
  editor: RefObject<HTMLTextAreaElement | null>
  preview: RefObject<HTMLDivElement | null>
  header: RefObject<HTMLDivElement | null>
  text: string
  previewing: boolean
  disabled: boolean
  onAction: (text: string, action: NotebookAction) => void
  onSelectionChange: (selected: boolean) => void
}

export function NotebookActions({ editor, preview, header, text, previewing, disabled, onAction, onSelectionChange }: Props) {
  const controls = useRef<HTMLDivElement>(null)
  const selected = useRef('')
  const [selection, setSelection] = useState('')

  useEffect(() => {
    const remember = (value: string) => {
      selected.current = value.trim() ? value : ''
      setSelection(selected.current)
      onSelectionChange(!!selected.current)
    }
    remember('')
    const readSelection = () => {
      const active = document.activeElement
      // Keep the captured passage while the user tabs or taps into the actions.
      // Focusing a button can collapse a native selection before its click fires.
      const field = editor.current
      if (field && active === field) {
        remember(field.value.slice(field.selectionStart, field.selectionEnd))
        return
      }
      const range = window.getSelection()
      if (range && !range.isCollapsed && preview.current?.contains(range.anchorNode) && preview.current.contains(range.focusNode)) {
        remember(range.toString())
      } else if (!header.current?.contains(active)) remember('')
    }
    const dismissOutside = (event: Event) => {
      const target = event.target as Node
      if (!header.current?.contains(target) && target !== editor.current && !preview.current?.contains(target)) {
        const range = window.getSelection()
        if (range && preview.current?.contains(range.anchorNode)) range.removeAllRanges()
        remember('')
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !selected.current) return
      if (controls.current?.contains(document.activeElement)) {
        if (editor.current) editor.current.focus({ preventScroll: true })
        else preview.current?.focus({ preventScroll: true })
      }
      const field = editor.current
      if (field) field.setSelectionRange(field.selectionEnd, field.selectionEnd)
      const range = window.getSelection()
      if (range && preview.current?.contains(range.anchorNode)) range.removeAllRanges()
      remember('')
    }
    document.addEventListener('selectionchange', readSelection)
    const field = editor.current
    field?.addEventListener('select', readSelection)
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('focusin', dismissOutside)
    document.addEventListener('keydown', escape)
    readSelection()
    return () => {
      document.removeEventListener('selectionchange', readSelection)
      field?.removeEventListener('select', readSelection)
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('focusin', dismissOutside)
      document.removeEventListener('keydown', escape)
    }
  }, [text, previewing, editor, preview, header, onSelectionChange])

  return <div className="notebook-context-actions" ref={controls} role="group" aria-label="Notebook actions"
    onPointerDown={event => { if (event.button === 0) event.preventDefault() }}>
    {(Object.entries(NOTEBOOK_ACTIONS) as [NotebookAction, string][]).map(([action, label]) =>
      <button type="button" key={action} className="notebook-text-action" disabled={disabled || !text.trim()}
        aria-describedby="notebook-action-scope" title={`${label}: ${selection ? 'selected passage' : 'whole notebook'}`}
        onClick={() => onAction(selected.current || text, action)}>{label}</button>)}
  </div>
}
