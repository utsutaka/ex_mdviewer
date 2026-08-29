import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  CloseTabRequest,
  CloseTabResponse,
  DisplayModeChangedPayload,
  FocusTabPayload,
  TabCreatedPayload,
  Theme
} from '@shared/types'

/** タブバーView向けAPI */
const api = {
  openFile(filePath: string): void {
    ipcRenderer.send('open-file', { filePath })
  },
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  getAppSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('get-app-settings')
  },
  closeTab(tabId: string): Promise<CloseTabResponse> {
    const request: CloseTabRequest = { tabId }
    return ipcRenderer.invoke('close-tab', request)
  },
  activateTab(tabId: string): void {
    ipcRenderer.send('activate-tab', { tabId })
  },
  toggleDisplayMode(tabId: string): void {
    ipcRenderer.send('toggle-display-mode', { tabId })
  },
  themeChanged(theme: Theme): void {
    ipcRenderer.send('theme-changed', { theme })
  },
  requestSearchFocus(): void {
    ipcRenderer.send('request-search-focus')
  },
  requestFindNext(forward: boolean): void {
    ipcRenderer.send('request-find-next', { forward })
  },

  onTabCreated(callback: (payload: TabCreatedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: TabCreatedPayload): void => callback(payload)
    ipcRenderer.on('tab-created', listener)
    return () => ipcRenderer.removeListener('tab-created', listener)
  },
  onFocusTab(callback: (payload: FocusTabPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FocusTabPayload): void => callback(payload)
    ipcRenderer.on('focus-tab', listener)
    return () => ipcRenderer.removeListener('focus-tab', listener)
  },
  onDisplayModeChanged(callback: (payload: DisplayModeChangedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DisplayModeChangedPayload): void => callback(payload)
    ipcRenderer.on('display-mode-changed', listener)
    return () => ipcRenderer.removeListener('display-mode-changed', listener)
  },
  onTabLoaded(callback: (tabId: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: { tabId: string }): void => callback(payload.tabId)
    ipcRenderer.on('tab-loaded', listener)
    return () => ipcRenderer.removeListener('tab-loaded', listener)
  },
  onMenuThemeToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-theme-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-theme-toggle-requested', listener)
  },
  onThemeUpdated(callback: (theme: Theme) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { theme: Theme }): void => callback(request.theme)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  }
}

export type TabBarApi = typeof api

contextBridge.exposeInMainWorld('tabBarApi', api)
