import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, FolderListUpdatedPayload, Theme } from '@shared/types'

/** エクスプローラーサイドバーView向けAPI（038-explorer-sidebar、sidebar-toc-preload.tsと同型） */
const api = {
  getAppSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('get-app-settings')
  },
  explorerVisibilityChanged(visible: boolean): void {
    ipcRenderer.send('explorer-visibility-changed', { visible })
  },
  explorerWidthPreview(width: number): void {
    ipcRenderer.send('explorer-width-preview', { width })
  },
  explorerWidthChanged(width: number): void {
    ipcRenderer.send('explorer-width-changed', { width })
  },
  openFile(filePath: string): void {
    ipcRenderer.send('explorer-open-file', { filePath })
  },

  onFolderListUpdated(callback: (payload: FolderListUpdatedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FolderListUpdatedPayload): void => callback(payload)
    ipcRenderer.on('folder-list-updated', listener)
    return () => ipcRenderer.removeListener('folder-list-updated', listener)
  },
  onMenuExplorerVisibilityToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-explorer-visibility-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-explorer-visibility-toggle-requested', listener)
  },
  onThemeUpdated(callback: (theme: Theme) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { theme: Theme }): void => callback(request.theme)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  }
}

export type SidebarExplorerApi = typeof api

contextBridge.exposeInMainWorld('explorerApi', api)
