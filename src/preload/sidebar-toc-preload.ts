import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  FindInPageResultPayload,
  HeadingListUpdatedPayload,
  NavigateToHeadingRequest,
  RestoreSearchTextPayload,
  SearchClearedPayload,
  Theme,
  ZoomDeltaRequest
} from '@shared/types'

/** TOCサイドバーView向けAPI */
const api = {
  getAppSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('get-app-settings')
  },
  tocVisibilityChanged(visible: boolean): void {
    ipcRenderer.send('toc-visibility-changed', { visible })
  },
  tocWidthChanged(width: number): void {
    ipcRenderer.send('toc-width-changed', { width })
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
  navigateToHeading(request: NavigateToHeadingRequest): void {
    ipcRenderer.send('navigate-to-heading', request)
  },
  searchTextChanged(tabId: string, text: string): void {
    ipcRenderer.send('search-text-changed', { tabId, text })
  },
  requestFindNext(forward: boolean): void {
    ipcRenderer.send('request-find-next', { forward })
  },
  notifyZoomDelta(payload: ZoomDeltaRequest): void {
    ipcRenderer.send('zoom-delta', payload)
  },

  onFindInPageResult(callback: (payload: FindInPageResultPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FindInPageResultPayload): void => callback(payload)
    ipcRenderer.on('find-in-page-result', listener)
    return () => ipcRenderer.removeListener('find-in-page-result', listener)
  },
  onHeadingListUpdated(callback: (payload: HeadingListUpdatedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: HeadingListUpdatedPayload): void => callback(payload)
    ipcRenderer.on('heading-list-updated', listener)
    return () => ipcRenderer.removeListener('heading-list-updated', listener)
  },
  onMenuTocVisibilityToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-toc-visibility-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-toc-visibility-toggle-requested', listener)
  },
  onThemeUpdated(callback: (theme: Theme) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { theme: Theme }): void => callback(request.theme)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  },
  onFocusSidebarSearch(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('focus-sidebar-search', listener)
    return () => ipcRenderer.removeListener('focus-sidebar-search', listener)
  },
  onSearchCleared(callback: (payload: SearchClearedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: SearchClearedPayload): void => callback(payload)
    ipcRenderer.on('search-cleared', listener)
    return () => ipcRenderer.removeListener('search-cleared', listener)
  },
  onRestoreSearchText(callback: (payload: RestoreSearchTextPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: RestoreSearchTextPayload): void => callback(payload)
    ipcRenderer.on('restore-search-text', listener)
    return () => ipcRenderer.removeListener('restore-search-text', listener)
  }
}

export type SidebarTocApi = typeof api

contextBridge.exposeInMainWorld('sidebarTocApi', api)
