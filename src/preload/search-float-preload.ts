import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  FindInPageResultPayload,
  RestoreSearchTextPayload,
  SearchClearedPayload,
  Theme
} from '@shared/types'

/** フロート検索View向けAPI */
const api = {
  getAppSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('get-app-settings')
  },
  findInPage(text: string, forward: boolean, findNext: boolean): void {
    ipcRenderer.send('find-in-page', { text, forward, findNext })
  },
  stopFindInPage(action: 'clearSelection' | 'keepSelection'): void {
    ipcRenderer.send('stop-find-in-page', { action })
  },
  searchFocusStateChanged(inUse: boolean, view: 'toc' | 'float'): void {
    ipcRenderer.send('search-focus-state-changed', { inUse, view })
  },
  scrollContent(direction: 'up' | 'down'): void {
    ipcRenderer.send('scroll-content', { direction })
  },
  closeSearchFloat(): void {
    ipcRenderer.send('close-search-float')
  },
  searchTextChanged(tabId: string, text: string): void {
    ipcRenderer.send('search-text-changed', { tabId, text })
  },
  requestFindNext(forward: boolean): void {
    ipcRenderer.send('request-find-next', { forward })
  },

  onFindInPageResult(callback: (payload: FindInPageResultPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FindInPageResultPayload): void => callback(payload)
    ipcRenderer.on('find-in-page-result', listener)
    return () => ipcRenderer.removeListener('find-in-page-result', listener)
  },
  onThemeUpdated(callback: (theme: Theme) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { theme: Theme }): void => callback(request.theme)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  },
  onSearchCleared(callback: (payload: SearchClearedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: SearchClearedPayload): void => callback(payload)
    ipcRenderer.on('search-cleared', listener)
    return () => ipcRenderer.removeListener('search-cleared', listener)
  },
  onSearchFloatShown(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('search-float-shown', listener)
    return () => ipcRenderer.removeListener('search-float-shown', listener)
  },
  onRestoreSearchText(callback: (payload: RestoreSearchTextPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: RestoreSearchTextPayload): void => callback(payload)
    ipcRenderer.on('restore-search-text', listener)
    return () => ipcRenderer.removeListener('restore-search-text', listener)
  }
}

export type SearchFloatApi = typeof api

contextBridge.exposeInMainWorld('searchFloatApi', api)
