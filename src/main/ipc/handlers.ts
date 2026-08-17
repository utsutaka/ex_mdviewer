import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import type {
  CloseTabRequest,
  CloseTabResponse,
  ContentWidthModeChangedRequest,
  FileOpenedPayload,
  FindInPageRequest,
  FindInPageResultPayload,
  FocusTabPayload,
  OpenFileRequest,
  PdfTabActiveChangedRequest,
  StopFindInPageRequest,
  TabCreatedPayload,
  ThemeChangedRequest,
  TocVisibilityChangedRequest,
  UnsupportedFilePayload,
  YamlDocumentGroup
} from '@shared/types'
import { resolveFileKind } from '@shared/file-kind'
import { decodeFileBuffer } from '../file-encoding'
import { yamlToStructuredNodes } from '../yaml-adapter'
import { unwatchFile, watchFile } from '../file-watcher'
import { refreshAppMenu } from '../menu'
import { isPdfSignatureValid } from '../pdf-signature'
import { startPdfPageTracking, stopPdfPageTracking } from '../pdf-page-tracker'
import { getAppSettings, setAppSettings } from '../store'
import { getMainWindow, restoreAndFocusWindow } from '../window'

interface TabRuntimeState {
  tabId: string
  filePath: string
}

/** ウィンドウ内で現在開いているタブのランタイム状態（filePathの重複排除・close-tab処理に使用） */
export const openTabs = new Map<string, TabRuntimeState>()

/** 同一ファイル判定用のパス正規化（大文字小文字を区別しない、Assumptions） */
function normalizePath(filePath: string): string {
  return resolve(filePath).toLowerCase()
}

function findExistingTabByPath(filePath: string): TabRuntimeState | undefined {
  const normalized = normalizePath(filePath)
  return Array.from(openTabs.values()).find((tab) => normalizePath(tab.filePath) === normalized)
}

/**
 * ファイルを開く要求を処理する（FR-001, FR-017, FR-034, FR-039）。
 * コンテンツ読み込みの完了を待たずtab-createdを即座に送出し、
 * 複数要求はawaitで直列化しないことで互いをブロックしない（FR-034）。
 * 同一ファイルが既に開かれている場合は新規作成せず該当タブへフォーカスする（FR-038）。
 */
export async function handleOpenFile(filePath: string): Promise<void> {
  const win = getMainWindow()
  if (!win) {
    return
  }

  // 最小化・背面のウィンドウを復元・最前面表示してから処理する（FR-019）
  restoreAndFocusWindow(win)

  const fileKind = resolveFileKind(filePath)
  if (fileKind === null) {
    const payload: UnsupportedFilePayload = { filePath }
    win.webContents.send('unsupported-file', payload)
    return
  }

  const existing = findExistingTabByPath(filePath)
  if (existing) {
    const payload: FocusTabPayload = { tabId: existing.tabId }
    win.webContents.send('focus-tab', payload)
    return
  }

  const tabId = randomUUID()
  openTabs.set(tabId, { tabId, filePath })

  const title = basename(filePath, extname(filePath))
  const tabCreated: TabCreatedPayload = { tabId, filePath, title }
  win.webContents.send('tab-created', tabCreated)

  const { content, encodingStatus, isEmptyFile, isInvalidPdf } = await (async () => {
    try {
      const buffer = await readFile(filePath)
      if (fileKind === 'pdf') {
        // PDFはバイナリのためdecodeFileBufferを呼ばない（011-html-pdf-viewer research.md Decision 4）
        const isEmpty = buffer.length === 0
        return {
          content: '',
          encodingStatus: 'utf-8' as const,
          isEmptyFile: isEmpty,
          // 先頭バイトがPDFのマジックバイトと一致しない場合、PDFビューアへ渡さない（FR-019, research.md Decision 8）
          isInvalidPdf: !isEmpty && !isPdfSignatureValid(buffer)
        }
      }
      const decoded = decodeFileBuffer(buffer)
      return {
        ...decoded,
        isEmptyFile: fileKind === 'html' ? decoded.content === '' : false,
        isInvalidPdf: false
      }
    } catch {
      // 読み込み自体に失敗した場合も、可能な範囲でベストエフォート表示を行う（FR-016）
      return { content: '', encodingStatus: 'unrecognized' as const, isEmptyFile: false, isInvalidPdf: false }
    }
  })()

  let yamlDocuments: YamlDocumentGroup[] | null = null
  let structuredParseError = false
  if (fileKind === 'yaml' && content !== '') {
    try {
      yamlDocuments = yamlToStructuredNodes(content)
    } catch {
      structuredParseError = true
    }
  }

  const fileOpened: FileOpenedPayload = {
    tabId,
    filePath,
    rawContent: content,
    encodingStatus,
    // 見出し抽出はrenderer側のtoc.ts（Phase 4）が担う。mermaidBlocksと同様、
    // main側での二重パースを避けるためIPCペイロードには含めない。
    headings: [],
    loadStatus: 'loaded',
    fileKind,
    yamlDocuments,
    structuredParseError,
    isEmptyFile,
    isInvalidPdf
  }
  win.webContents.send('file-opened', fileOpened)
  watchFile(filePath, tabId)
}

/**
 * タブを閉じる（FR-026, FR-027）。最後の1タブの場合はウィンドウ全体を閉じる。
 */
function handleCloseTab(tabId: string): CloseTabResponse {
  const win = getMainWindow()
  const tab = openTabs.get(tabId)
  if (tab) {
    unwatchFile(tab.filePath, tabId)
    openTabs.delete(tabId)
    if (resolveFileKind(tab.filePath) === 'pdf') {
      stopPdfPageTracking(tabId)
    }
  }

  if (openTabs.size === 0) {
    win?.close()
    return { windowClosed: true }
  }

  return { windowClosed: false }
}

/**
 * webContentsの`found-in-page`イベントを`find-in-page-result`としてrendererへ中継する（FR-005）。
 * ウィンドウ生成後に一度だけ呼び出す。
 */
export function setupFoundInPageRelay(win: Electron.BrowserWindow): void {
  win.webContents.on('found-in-page', (_event, result) => {
    const payload: FindInPageResultPayload = {
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches
    }
    win.webContents.send('find-in-page-result', payload)
  })
}

let handlersRegistered = false

/**
 * レンダラーからのIPCリクエストを処理するハンドラー群を登録する。
 * 各チャネルの実処理は対応するUser Story実装フェーズで追加する。
 */
export function registerIpcHandlers(): void {
  if (handlersRegistered) {
    return
  }
  handlersRegistered = true

  ipcMain.on('open-file', (_event, request: OpenFileRequest) => {
    void handleOpenFile(request.filePath)
  })

  ipcMain.on('find-in-page', (_event, request: FindInPageRequest) => {
    const win = getMainWindow()
    win?.webContents.findInPage(request.text, {
      forward: request.forward,
      findNext: request.findNext
    })
  })

  ipcMain.on('stop-find-in-page', (_event, request: StopFindInPageRequest) => {
    const win = getMainWindow()
    win?.webContents.stopFindInPage(request.action)
  })

  ipcMain.handle('get-app-settings', () => getAppSettings())

  ipcMain.on('theme-changed', (_event, request: ThemeChangedRequest) => {
    setAppSettings({ ...getAppSettings(), theme: request.theme })
    refreshAppMenu()
  })

  ipcMain.on('toc-visibility-changed', (_event, request: TocVisibilityChangedRequest) => {
    setAppSettings({ ...getAppSettings(), tocVisible: request.visible })
    refreshAppMenu()
  })

  ipcMain.on('content-width-mode-changed', (_event, request: ContentWidthModeChangedRequest) => {
    setAppSettings({ ...getAppSettings(), contentWidthMode: request.mode })
    refreshAppMenu()
  })

  ipcMain.handle('close-tab', (_event, request: CloseTabRequest) => handleCloseTab(request.tabId))

  ipcMain.on('pdf-tab-active-changed', (_event, request: PdfTabActiveChangedRequest) => {
    const win = getMainWindow()
    if (!win) {
      return
    }
    if (request.active) {
      startPdfPageTracking(win, request.tabId)
    } else {
      stopPdfPageTracking(request.tabId)
    }
  })
}
