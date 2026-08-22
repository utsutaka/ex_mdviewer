import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  CloseTabRequest,
  CloseTabResponse,
  ContentWidthModeChangedRequest,
  FileMissingPayload,
  FileOpenedPayload,
  FindInPageResultPayload,
  FocusTabPayload,
  OpenFileDialogErrorPayload,
  PdfPageInfoPayload,
  PdfTabActiveChangedRequest,
  SettingsPersistenceErrorPayload,
  TabCreatedPayload,
  ThemeChangedRequest,
  TocVisibilityChangedRequest,
  TocWidthChangedRequest,
  UnsupportedFilePayload
} from '@shared/types'

/** contracts/ipc-contract.mdで定義した全チャネルをrendererへ公開するAPIラッパー */
const api = {
  openFile(filePath: string): void {
    ipcRenderer.send('open-file', { filePath })
  },
  /** ドラッグ&ドロップで取得したFileオブジェクトから絶対パスを取得する（FR-001） */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  closeTab(tabId: string): Promise<CloseTabResponse> {
    const request: CloseTabRequest = { tabId }
    return ipcRenderer.invoke('close-tab', request)
  },
  themeChanged(theme: ThemeChangedRequest['theme']): void {
    ipcRenderer.send('theme-changed', { theme })
  },
  tocVisibilityChanged(visible: TocVisibilityChangedRequest['visible']): void {
    ipcRenderer.send('toc-visibility-changed', { visible })
  },
  tocWidthChanged(width: TocWidthChangedRequest['width']): void {
    ipcRenderer.send('toc-width-changed', { width })
  },
  contentWidthModeChanged(mode: ContentWidthModeChangedRequest['mode']): void {
    ipcRenderer.send('content-width-mode-changed', { mode })
  },
  getAppSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('get-app-settings')
  },
  findInPage(text: string, forward: boolean, findNext: boolean): void {
    ipcRenderer.send('find-in-page', { text, forward, findNext })
  },
  stopFindInPage(action: 'clearSelection' | 'keepSelection'): void {
    ipcRenderer.send('stop-find-in-page', { action })
  },
  notifyPdfTabActiveChanged(payload: PdfTabActiveChangedRequest): void {
    ipcRenderer.send('pdf-tab-active-changed', payload)
  },

  onTabCreated(callback: (payload: TabCreatedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: TabCreatedPayload): void =>
      callback(payload)
    ipcRenderer.on('tab-created', listener)
    return () => ipcRenderer.removeListener('tab-created', listener)
  },
  onFileOpened(callback: (payload: FileOpenedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FileOpenedPayload): void =>
      callback(payload)
    ipcRenderer.on('file-opened', listener)
    return () => ipcRenderer.removeListener('file-opened', listener)
  },
  onUnsupportedFile(callback: (payload: UnsupportedFilePayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: UnsupportedFilePayload): void =>
      callback(payload)
    ipcRenderer.on('unsupported-file', listener)
    return () => ipcRenderer.removeListener('unsupported-file', listener)
  },
  onFileChanged(callback: (payload: FileOpenedPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FileOpenedPayload): void =>
      callback(payload)
    ipcRenderer.on('file-changed', listener)
    return () => ipcRenderer.removeListener('file-changed', listener)
  },
  onFileMissing(callback: (payload: FileMissingPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FileMissingPayload): void =>
      callback(payload)
    ipcRenderer.on('file-missing', listener)
    return () => ipcRenderer.removeListener('file-missing', listener)
  },
  onFocusTab(callback: (payload: FocusTabPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: FocusTabPayload): void =>
      callback(payload)
    ipcRenderer.on('focus-tab', listener)
    return () => ipcRenderer.removeListener('focus-tab', listener)
  },
  onFindInPageResult(callback: (payload: FindInPageResultPayload) => void): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: FindInPageResultPayload
    ): void => callback(payload)
    ipcRenderer.on('find-in-page-result', listener)
    return () => ipcRenderer.removeListener('find-in-page-result', listener)
  },
  onSettingsReset(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('settings-reset', listener)
    return () => ipcRenderer.removeListener('settings-reset', listener)
  },
  onFatalError(callback: (message: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void =>
      callback(message)
    ipcRenderer.on('fatal-error', listener)
    return () => ipcRenderer.removeListener('fatal-error', listener)
  },
  onSettingsPersistenceError(
    callback: (payload: SettingsPersistenceErrorPayload) => void
  ): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: SettingsPersistenceErrorPayload
    ): void => callback(payload)
    ipcRenderer.on('settings-persistence-error', listener)
    return () => ipcRenderer.removeListener('settings-persistence-error', listener)
  },
  onMenuThemeToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-theme-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-theme-toggle-requested', listener)
  },
  onMenuTocVisibilityToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-toc-visibility-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-toc-visibility-toggle-requested', listener)
  },
  onMenuContentWidthToggleRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('menu-content-width-toggle-requested', listener)
    return () => ipcRenderer.removeListener('menu-content-width-toggle-requested', listener)
  },
  onExternalLinkOpenFailed(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('external-link-open-failed', listener)
    return () => ipcRenderer.removeListener('external-link-open-failed', listener)
  },
  onOpenFileDialogError(callback: (payload: OpenFileDialogErrorPayload) => void): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: OpenFileDialogErrorPayload
    ): void => callback(payload)
    ipcRenderer.on('open-file-dialog-error', listener)
    return () => ipcRenderer.removeListener('open-file-dialog-error', listener)
  },
  onPdfPageInfo(callback: (payload: PdfPageInfoPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: PdfPageInfoPayload): void =>
      callback(payload)
    ipcRenderer.on('pdf-page-info', listener)
    return () => ipcRenderer.removeListener('pdf-page-info', listener)
  }
}

export type MdviewerApi = typeof api

contextBridge.exposeInMainWorld('api', api)
