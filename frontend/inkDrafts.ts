import type { InkPageData } from './ink'
import type { ConversionDraft } from './api'
export type DraftPage = InkPageData & { dirty: boolean; pending?: InkPageData; conflict?: boolean }
export type DraftWrite = { page: DraftPage; index: number }
let database: Promise<IDBDatabase> | undefined
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('verso-ink', 3)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('conversions')) db.createObjectStore('conversions')
      const pages = db.objectStoreNames.contains('pages') ? request.transaction!.objectStore('pages')
        : db.createObjectStore('pages', { keyPath: ['topic', 'id'] })
      if (!pages.indexNames.contains('topic')) pages.createIndex('topic', 'topic')
      // Preserve drafts created by the initial development build.
      if (db.objectStoreNames.contains('drafts')) {
        const cursor = request.transaction!.objectStore('drafts').openCursor()
        cursor.onsuccess = () => {
          const entry = cursor.result
          if (!entry) { db.deleteObjectStore('drafts'); return }
          ;(entry.value as DraftPage[]).forEach((page, index) => pages.put({ topic: entry.key, id: page.id, index, page }))
          entry.continue()
        }
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined }
      resolve(request.result)
    }
    request.onerror = () => { database = undefined; reject(request.error) }
    request.onblocked = () => { database = undefined; reject(new Error('Close other Verso tabs to update tablet storage.')) }
  })
}
export async function readDraft(topic: string): Promise<DraftPage[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('pages').objectStore('pages').index('topic').getAll(topic)
    request.onsuccess = () => resolve((request.result as DraftWrite[]).sort((a, b) => a.index - b.index).map(record => record.page))
    request.onerror = () => reject(request.error)
  })
}
export async function writeDraft(topic: string, changes: DraftWrite[]) {
  const db = await open()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('pages', 'readwrite')
    for (const change of changes) transaction.objectStore('pages').put({ ...change, topic, id: change.page.id })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
export async function deleteDraft(topic: string) {
  const db = await open()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['pages', 'conversions'], 'readwrite')
    transaction.objectStore('conversions').delete(topic)
    const cursor = transaction.objectStore('pages').index('topic').openCursor(topic)
    cursor.onsuccess = () => { const entry = cursor.result; if (entry) { entry.delete(); entry.continue() } }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function readConversion(topic: string): Promise<ConversionDraft | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('conversions').objectStore('conversions').get(topic)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function saveConversion(topic: string, draft?: ConversionDraft) {
  const db = await open()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('conversions', 'readwrite'), store = transaction.objectStore('conversions')
    if (draft) store.put(draft, topic); else store.delete(topic)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
