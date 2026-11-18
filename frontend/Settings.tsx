import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorMessage, type Settings as ModelSettings } from './api'

export function Settings({ initial, onClose, onSave }: { initial: ModelSettings; onClose: () => void; onSave: (settings: ModelSettings) => void }) {
  const [value, setValue] = useState(initial)
  const [key, setKey] = useState(''), [remember, setRemember] = useState(false), [clear, setClear] = useState(false)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])

  async function save(test: false | 'connection' | 'vision' = false) {
    setBusy(true); setError(''); setNotice('')
    let saved: ModelSettings | undefined
    try {
      const result = await api<ModelSettings>('/settings', 'PUT', {
        ...value, api_key: key || null, remember_key: remember, clear_key: clear,
      })
      saved = result
      setValue(result); setKey(''); setClear(false); onSave(result)
      const message = result.key_source === 'session' ? 'Saved. The API key is held only until the backend restarts.' : 'Settings saved.'
      setNotice(test ? 'Settings saved. Waiting for the model…' : message)
      if (test === 'connection') { await api('/settings/test', 'POST'); setNotice(`${message} Model connection works.`) }
      if (test === 'vision') {
        const verified = await api<ModelSettings>('/settings/test-vision', 'POST')
        setValue(verified); onSave(verified)
        setNotice('Image support verified. You can now share handwritten pages and selections. This checks image reading, not handwriting accuracy.')
      }
    } catch (err) {
      setError(errorMessage(err)); setNotice('')
      if (test === 'vision' && saved) { setValue({ ...saved, vision_verified: false }); onSave({ ...saved, vision_verified: false }) }
    }
    finally { setBusy(false) }
  }

  const update = <K extends keyof ModelSettings>(field: K, next: ModelSettings[K]) => setValue(previous => ({ ...previous, [field]: next }))
  return <dialog ref={dialog} className="settings-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void save() }}>
      <div className="dialog-heading"><h2>Model settings</h2><button type="button" aria-label="Close settings" disabled={busy} onClick={onClose}>×</button></div>
      <fieldset disabled={busy}>
        <label>Connection<select value={value.mode} onChange={event => {
          const mode = event.target.value as 'local' | 'cloud'
          setValue({ ...value, mode, provider: 'openai', endpoint: mode === 'local' ? 'http://127.0.0.1:11434/v1' : '', model: mode === 'local' ? 'gemma4:12b' : '' })
          setKey(''); setClear(false)
        }}><option value="local">Local model</option><option value="cloud">Hosted provider · bring your own key</option></select></label>
        {value.mode === 'cloud' && <>
          <p className="notice">Messages, recent hidden history, and notebook text or ink snapshots you share will be sent to the selected provider. Ink actions share the selected area or current page. Provider usage may incur charges.</p>
          <label>Provider<select value={value.provider} onChange={event => { update('provider', event.target.value as ModelSettings['provider']); setKey(''); setClear(false) }}>
            <option value="openai">OpenAI / OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option>
          </select></label>
        </>}
        <label>Endpoint<input type="url" value={value.endpoint} required={value.mode === 'local'} placeholder="Leave blank for the provider default" onChange={event => update('endpoint', event.target.value)} /></label>
        <label>Model name<input required value={value.model} placeholder="Model ID from your provider" onChange={event => update('model', event.target.value)} /></label>
        <div className="form-row">
          <label>Context window<input type="number" min="1024" max="2000000" required value={value.context_window} onChange={event => update('context_window', Number(event.target.value))} /></label>
          <label>Maximum response tokens<input type="number" min="64" max="64000" placeholder="Model default" value={value.max_output_tokens ?? ''} onChange={event => update('max_output_tokens', event.target.value === '' ? null : Number(event.target.value))} /></label>
        </div>
        <p className="field-help">Match the context window to your model server’s configuration. Older turns are kept on the host, but only recent turns that fit are sent.</p>
        <p className="field-help">Leave maximum response tokens blank to let the model finish naturally within its own limits.</p>
        <p className="field-help">{value.vision_verified ? 'Image support verified for the saved connection.' : 'Handwriting actions require an image-capable model.'} Use the image check below to test the saved model with a small generated image. Your notes are not used in this check.</p>
        <label>API key {value.mode === 'local' && '(optional)'}<input type="password" autoComplete="off" value={key} placeholder="Enter to replace the current key" onChange={event => { setKey(event.target.value); setClear(false) }} /></label>
        <p className="field-help">Current key source: {value.key_source}. Keys are never returned to the browser.</p>
        <label className="check"><input type="checkbox" checked={remember} disabled={!value.keyring_available} onChange={event => setRemember(event.target.checked)} />Remember in the host’s OS credential store</label>
        {!value.keyring_available && <p className="field-help">No supported OS credential store is available. New keys last until the backend restarts.</p>}
        <label className="check"><input type="checkbox" checked={clear} onChange={event => { setClear(event.target.checked); setKey('') }} />Remove saved/session key for this connection</label>
        {value.key_source === 'environment' && <p className="field-help">Environment keys must be removed from the host configuration.</p>}
      </fieldset>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => void save('connection')}>Save & test connection</button><button type="button" disabled={busy} onClick={() => void save('vision')}>Save & verify images</button><button className="primary" disabled={busy} type="submit">{busy ? 'Working…' : 'Save settings'}</button></div>
    </form>
  </dialog>
}
