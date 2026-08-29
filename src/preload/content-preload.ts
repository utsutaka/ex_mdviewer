import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActivateTabContentPayload,
  AppSettings,
  ContentWidthMode,
  DisplayModeChangedPayload,
  FileMissingPayload,
  FileOpenedPayload,
  HeadingListUpdatedPayload,
  NavigateToHeadingRequest,
  OpenFileDialogErrorPayload,
  PdfPageInfoPayload,
  PdfTabActiveChangedRequest,
  ScrollContentRequest,
  SettingsPersistenceErrorPayload,
  TabContentClosedPayload,
  TabContentCreatedPayload,
  Theme,
  ToggleDisplayModeRequest,
  UnsupportedFilePayload
} from '@shared/types'

/** 本文View向けAPI（plan.md「既存preload/index.tsのAPI割り当て」参照） */
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
  contentWidthModeChanged(mode: ContentWidthMode): void {
    ipcRenderer.send('content-width-mode-changed', { mode })
  },
  notifyPdfTabActiveChanged(payload: PdfTabActiveChangedRequest): void {
    ipcRenderer.send('pdf-tab-active-changed', payload)
  },
  requestSearchFocus(): void {
    ipcRenderer.send('request-search-focus')
  },
  requestFindNext(forward: boolean): void {
    ipcRenderer.send('request-find-next', { forward })
  },
  notifyHeadingListUpdated(payload: HeadingListUpdatedPayload): void {
    ipcRenderer.send('heading-list-updated', payload)
  },
  notifyDisplayModeChanged(payload: DisplayModeChangedPayload): void {
    ipcRenderer.send('display-mode-changed', payload)
  },
  acknowledgeTabContentCreated(tabId: string): void {
    ipcRenderer.send('tab-content-created-ack', { tabId })
  },
  notifyTabLoaded(tabId: string): void {
    ipcRenderer.send('tab-loaded', { tabId })
  },

  onTabContentCreated(callback: (payload: TabContentCreatedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: TabContentCreatedPayload): void => callback(payload)
    ipcRenderer.on('tab-content-created', listener)
    return () => ipcRenderer.removeListener('tab-content-created', listener)
  },
  onActivateTabContent(callback: (payload: ActivateTabContentPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: ActivateTabContentPayload): void => callback(payload)
    ipcRenderer.on('activate-tab-content', listener)
    return () => ipcRenderer.removeListener('activate-tab-content', listener)
  },
  onTabContentClosed(callback: (payload: TabContentClosedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: TabContentClosedPayload): void => callback(payload)
    ipcRenderer.on('tab-content-closed', listener)
    return () => ipcRenderer.removeListener('tab-content-closed', listener)
  },
  onTabContentCreationTimeout(callback: (payload: { tabId: string }) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: { tabId: string }): void => callback(payload)
    ipcRenderer.on('tab-content-creation-timeout', listener)
    return () => ipcRenderer.removeListener('tab-content-creation-timeout', listener)
  },
  onFileOpened(callback: (payload: FileOpenedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FileOpenedPayload): void => callback(payload)
    ipcRenderer.on('file-opened', listener)
    return () => ipcRenderer.removeListener('file-opened', listener)
  },
  onFileChanged(callback: (payload: FileOpenedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FileOpenedPayload): void => callback(payload)
    ipcRenderer.on('file-changed', listener)
    return () => ipcRenderer.removeListener('file-changed', listener)
  },
  onFileMissing(callback: (payload: FileMissingPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FileMissingPayload): void => callback(payload)
    ipcRenderer.on('file-missing', listener)
    return () => ipcRenderer.removeListener('file-missing', listener)
  },
  onUnsupportedFile(callback: (payload: UnsupportedFilePayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: UnsupportedFilePayload): void => callback(payload)
    ipcRenderer.on('unsupported-file', listener)
    return () => ipcRenderer.removeListener('unsupported-file', listener)
  },
  onToggleDisplayMode(callback: (request: ToggleDisplayModeRequest) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: ToggleDisplayModeRequest): void => callback(request)
    ipcRenderer.on('toggle-display-mode', listener)
    return () => ipcRenderer.removeListener('toggle-display-mode', listener)
  },
  onNavigateToHeading(callback: (request: NavigateToHeadingRequest) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: NavigateToHeadingRequest): void => callback(request)
    ipcRenderer.on('navigate-to-heading', listener)
    return () => ipcRenderer.removeListener('navigate-to-heading', listener)
  },
  onScrollContent(callback: (request: ScrollContentRequest) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: ScrollContentRequest): void => callback(request)
    ipcRenderer.on('scroll-content', listener)
    return () => ipcRenderer.removeListener('scroll-content', listener)
  },
  onSettingsReset(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('settings-reset', listener)
    return () => ipcRenderer.removeListener('settings-reset', listener)
  },
  onFatalError(callback: (message: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('fatal-error', listener)
    return () => ipcRenderer.removeListener('fatal-error', listener)
  },
  onSettingsPersistenceError(callback: (payload: SettingsPersistenceErrorPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: SettingsPersistenceErrorPayload): void =>
      callback(payload)
    ipcRenderer.on('settings-persistence-error', listener)
    return () => ipcRenderer.removeListener('settings-persistence-error', listener)
  },
  onExternalLinkOpenFailed(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('external-link-open-failed', listener)
    return () => ipcRenderer.removeListener('external-link-open-failed', listener)
  },
  onOpenFileDialogError(callback: (payload: OpenFileDialogErrorPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: OpenFileDialogErrorPayload): void => callback(payload)
    ipcRenderer.on('open-file-dialog-error', listener)
    return () => ipcRenderer.removeListener('open-file-dialog-error', listener)
  },
  onPdfPageInfo(callback: (payload: PdfPageInfoPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: PdfPageInfoPayload): void => callback(payload)
    ipcRenderer.on('pdf-page-info', listener)
    return () => ipcRenderer.removeListener('pdf-page-info', listener)
  },
  onThemeUpdated(callback: (theme: Theme) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { theme: Theme }): void => callback(request.theme)
    ipcRenderer.on('theme-updated', listener)
    return () => ipcRenderer.removeListener('theme-updated', listener)
  },
  onContentWidthModeUpdated(callback: (mode: ContentWidthMode) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { mode: ContentWidthMode }): void =>
      callback(request.mode)
    ipcRenderer.on('content-width-mode-updated', listener)
    return () => ipcRenderer.removeListener('content-width-mode-updated', listener)
  },
  onMenuContentWidthToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-content-width-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-content-width-toggle-requested', listener)
  }
}

export type ContentApi = typeof api

contextBridge.exposeInMainWorld('contentApi', api)
