import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type {
  ActivateTabContentPayload,
  CloseTabRequest,
  CloseTabResponse,
  ContentWidthModeChangedRequest,
  DisplayModeChangedPayload,
  FileOpenedPayload,
  FindInPageRequest,
  FindInPageResultPayload,
  FocusTabPayload,
  HeadingListUpdatedPayload,
  NavigateToHeadingRequest,
  OpenFileRequest,
  PdfTabActiveChangedRequest,
  RequestFindNextRequest,
  ScrollContentRequest,
  SearchFocusStateChangedRequest,
  SearchTextChangedRequest,
  StopFindInPageRequest,
  TabContentClosedPayload,
  TabContentCreatedPayload,
  TabCreatedPayload,
  ThemeChangedRequest,
  ToggleDisplayModeRequest,
  TocVisibilityChangedRequest,
  TocWidthChangedRequest,
  UnsupportedFilePayload,
  YamlDocumentGroup
} from '@shared/types'
import { resolveFileKind } from '@shared/file-kind'
import { decodeFileBuffer } from '../file-encoding'
import { yamlToStructuredNodes } from '../yaml-adapter'
import { unwatchFile, watchFile } from '../file-watcher'
import { addFolderToHistory } from '../folder-history'
import { refreshAppMenu } from '../menu'
import { isPdfSignatureValid } from '../pdf-signature'
import { startPdfPageTracking, stopPdfPageTracking } from '../pdf-page-tracker'
import { getAppSettings, setAppSettings } from '../store'
import {
  closeSearchFloatView,
  confirmCloseLastTab,
  getContentView,
  getMainWindow,
  getSearchFloatView,
  getSidebarTocView,
  getTabBarView,
  isSearchFloatVisible,
  markQuitHandled,
  openSearchFloatView,
  relayoutViews,
  restoreAndFocusWindow
} from '../window'

interface TabRuntimeState {
  tabId: string
  filePath: string
}

/** ウィンドウ内で現在開いているタブのランタイム状態（filePathの重複排除・close-tab処理に使用） */
export const openTabs = new Map<string, TabRuntimeState>()

/**
 * タブバーView向け`tab-created`と本文View向け`tab-content-created`の送出が
 * 一定時間内に両方揃うことを検知する（data-model.md Validation Rules、CHK003対応）。
 * 3秒はIPC往復として十分に余裕を持たせた値であり、実測次第で調整可（tasks.md T019）。
 */
const TAB_CONTENT_CREATION_TIMEOUT_MS = 3000
const pendingTabContentCreations = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleTabContentCreationCheck(tabId: string): void {
  const timer = setTimeout(() => {
    pendingTabContentCreations.delete(tabId)
    getContentView()?.webContents.send('tab-content-creation-timeout', { tabId })
  }, TAB_CONTENT_CREATION_TIMEOUT_MS)
  pendingTabContentCreations.set(tabId, timer)
}

/** 本文View側での`TabContentCache`生成完了通知（`tab-content-created-ack`）受信時に呼ぶ */
function acknowledgeTabContentCreated(tabId: string): void {
  const timer = pendingTabContentCreations.get(tabId)
  if (timer) {
    clearTimeout(timer)
    pendingTabContentCreations.delete(tabId)
  }
}

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
 *
 * ダイアログ経由・ドラッグ&ドロップ・二重起動・初回起動引数のいずれもこの関数に合流するため
 * （031-folder-history-menu research.md Decision 1）、新規タブ作成/既存タブフォーカスの
 * 分岐より前でフォルダ履歴への記録を行い、経路によらず一律に適用する（FR-001〜FR-003）。
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
    // トースト通知は本文Viewに属する（research.md Decision 10）
    getContentView()?.webContents.send('unsupported-file', payload)
    return
  }

  setAppSettings({
    ...getAppSettings(),
    folderHistory: addFolderToHistory(getAppSettings().folderHistory, dirname(filePath))
  })
  refreshAppMenu()

  const existing = findExistingTabByPath(filePath)
  if (existing) {
    clearSearchOnTabSwitch(existing.tabId)
    const payload: FocusTabPayload = { tabId: existing.tabId }
    getTabBarView()?.webContents.send('focus-tab', payload)
    const activatePayload: ActivateTabContentPayload = { tabId: existing.tabId }
    getContentView()?.webContents.send('activate-tab-content', activatePayload)
    return
  }

  const tabId = randomUUID()
  openTabs.set(tabId, { tabId, filePath })
  // 新規タブは作成後に自動的にアクティブ化されるため、検索状態もここで切り替える
  clearSearchOnTabSwitch(tabId)

  const title = basename(filePath)
  const tabCreated: TabCreatedPayload = { tabId, filePath, title }
  getTabBarView()?.webContents.send('tab-created', tabCreated)
  const tabContentCreated: TabContentCreatedPayload = tabCreated
  // 033-webcontentsview-search-fix: タブバーView・本文View両方への通知が一定時間内に
  // 揃わない場合の不整合検知（data-model.md Validation Rules、tasks.md T019）
  scheduleTabContentCreationCheck(tabId)
  getContentView()?.webContents.send('tab-content-created', tabContentCreated)

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
  getContentView()?.webContents.send('file-opened', fileOpened)
  watchFile(filePath, tabId)
}

/** タブ1件分のランタイム状態を破棄する（ファイル監視・PDFページ追跡の停止、openTabsからの削除） */
function removeTabRuntimeState(tabId: string, tab: TabRuntimeState): void {
  unwatchFile(tab.filePath, tabId)
  openTabs.delete(tabId)
  if (resolveFileKind(tab.filePath) === 'pdf') {
    stopPdfPageTracking(tabId)
  }
  const payload: TabContentClosedPayload = { tabId }
  getContentView()?.webContents.send('tab-content-closed', payload)
}

/**
 * openTabs内の全タブについてクリーンアップ処理を行い、openTabsを空にする
 * （022-quit-dialog-close-tab FR-007）。OS標準のウィンドウ閉じる操作で「はい」が
 * 選ばれた際、attachQuitConfirmation（src/main/window.ts）へ注入する。
 */
export function closeAllTabs(): void {
  for (const [tabId, tab] of openTabs) {
    unwatchFile(tab.filePath, tabId)
    if (resolveFileKind(tab.filePath) === 'pdf') {
      stopPdfPageTracking(tabId)
    }
  }
  openTabs.clear()
}

/**
 * タブを閉じる（001-core-viewer FR-026, FR-027）。開いているタブが1つだけの場合、実際にタブを
 * 削除する前にタブクローズ確認ダイアログを表示する（022-quit-dialog-close-tab FR-001〜FR-004）。
 * 「はい」の場合はタブ削除後にmarkQuitHandled()を呼びウィンドウを閉じる。「いいえ」の場合は
 * タブ削除のみ行いwin.close()は呼ばない（真のキャンセルは廃止、いずれの選択でもタブは削除される）。
 */
async function handleCloseTab(tabId: string): Promise<CloseTabResponse> {
  const win = getMainWindow()
  const tab = openTabs.get(tabId)
  const isLastTab = openTabs.size <= 1

  if (isLastTab && win) {
    const confirmed = await confirmCloseLastTab(win)

    if (tab) {
      removeTabRuntimeState(tabId, tab)
    }

    if (confirmed) {
      markQuitHandled()
      win.close()
      return { windowClosed: true }
    }

    return { windowClosed: false }
  }

  if (tab) {
    removeTabRuntimeState(tabId, tab)
  }

  return { windowClosed: false }
}

/**
 * 033-webcontentsview-search-fix: 検索バーの使用状況（FocusLockState、data-model.md）。
 * `activeSearchView`は`find-in-page`要求の送信元からも自動的に更新され、常に「直近に
 * 検索操作を行ったView」を指す（TOCサイドバー検索・フロート検索は排他的にしか開かれない
 * ため一意に定まる、spec.md Assumptions）。
 */
let searchInUse = false
let activeSearchView: 'toc' | 'float' = 'toc'
let contentFocusForcebackAttached = false

function resolveSearchViewFromSenderId(senderWebContentsId: number): 'toc' | 'float' | null {
  if (getSidebarTocView()?.webContents.id === senderWebContentsId) {
    return 'toc'
  }
  if (getSearchFloatView()?.webContents.id === senderWebContentsId) {
    return 'float'
  }
  return null
}

function getActiveSearchWebContentsView() {
  return activeSearchView === 'float' ? getSearchFloatView() : getSidebarTocView()
}

/** mainプロセス側で追跡する現在アクティブなタブID（タブ単位の検索状態管理に使用） */
let currentActiveTabId: string | null = null

/**
 * タブごとの検索文字列を保持する「真実の情報源」（実機フィードバック対応）。
 * TOCサイドバー内検索・フロート検索のどちらで入力しても、入力のたびにここへ通知され、
 * タブ切り替え時・TOCサイドバー内検索⇔フロート検索の切替時のいずれも、この状態を
 * 参照して復元する。これにより「同一タブ内ではTOC内検索とフロート検索で検索内容
 * （文字列・件数）を共有し、異なるタブでは共有しない」という要件を、検索UI側の
 * Map二重管理なしに一貫して満たせる。件数・ハイライトは文字列を復元した後
 * `findInPage`を再実行することで自然に復元される（明示的な保存は不要）。
 */
const searchTextByTabId = new Map<string, string>()

/**
 * TOCサイドバーの表示/非表示切替と、検索UIの自動切替を連動させる（実機フィードバック対応）。
 * - フロート検索が表示中にTOCが表示された場合: フロート検索を閉じ、TOCサイドバー内検索へ
 *   フォーカスを移し、現在の検索文字列を復元する。
 *   この判定は`searchInUse`（フォーカスの有無）ではなく`isSearchFloatVisible()`
 *   （フロート検索Viewの表示状態そのもの）を用いる。タブ切り替え時にタブバーViewへ
 *   OSレベルのキーボードフォーカスが移ることで、フロート検索の入力欄がblurし
 *   `searchInUse`がfalseになる場合があるが、フロート検索View自体は表示され続けており、
 *   その状態でTOCを表示してもフロート検索が閉じない不具合が実機で確認されたため。
 * - TOCサイドバー内検索使用中にTOCが非表示になった場合: フロート検索を開きフォーカスを移し、
 *   現在の検索文字列を復元する。こちらは「TOC内検索を実際に使用中（searchInUse）」の
 *   場合のみ発動し、検索を使っていないときのTOC非表示化には影響しない。
 * `findNext: true`（新規セッション開始）で検索し直しても、本文側に前回検索の選択位置が
 * 残ったままだと、Chromiumはその選択位置から前方一致を探すため検索位置（アクティブな
 * 一致の順番）が切替のたびに1件ずつ進んでしまう不具合が実機で確認された。そのため
 * 復元前に`stopFindInPage('clearSelection')`で選択位置をリセットしてから復元する
 * （renderer側`search`関数の`findNext: true`と組み合わせて、件数・位置とも1件目から
 * 正しく引き継がれる）。
 */
function handleTocVisibilityChangeForSearch(tocVisible: boolean, win: Electron.BrowserWindow): void {
  const restoredText = currentActiveTabId !== null ? (searchTextByTabId.get(currentActiveTabId) ?? '') : ''
  if (tocVisible && isSearchFloatVisible()) {
    getContentView()?.webContents.stopFindInPage('clearSelection')
    closeSearchFloatView()
    activeSearchView = 'toc'
    const view = getSidebarTocView()
    view?.webContents.focus()
    view?.webContents.send('focus-sidebar-search')
    view?.webContents.send('restore-search-text', { text: restoredText })
    return
  }
  if (!tocVisible && searchInUse && activeSearchView === 'toc') {
    getContentView()?.webContents.stopFindInPage('clearSelection')
    activeSearchView = 'float'
    openSearchFloatView(win)
    getSearchFloatView()?.webContents.send('restore-search-text', { text: restoredText })
  }
}

/**
 * タブ切り替え時、検索結果（件数・ハイライト・入力文字列）をタブ単位で切り替える
 * （実機フィードバック対応）。同一タブ内では検索内容（入力文字列・件数）を保持し、
 * 異なるタブに切り替えた場合は共有しない。mainプロセスが保持する`searchTextByTabId`
 * （真実の情報源）から切替先タブの検索文字列を取得し、通知に含める。非アクティブになる
 * タブのDOMはデタッチされ検索対象から外れるため（research.md Decision 2）、
 * findInPage自体も停止する。
 */
function clearSearchOnTabSwitch(newTabId: string): void {
  getContentView()?.webContents.stopFindInPage('clearSelection')
  const restoredText = searchTextByTabId.get(newTabId) ?? ''
  const previousTabId = currentActiveTabId
  // TOCサイドバー内検索・フロート検索の両方に送るが、実際に`findInPage`を実行してよいのは
  // 現在アクティブな検索UI（`activeSearchView`）側のみ（`SearchClearedPayload.isActiveView`
  // コメント参照）。両方に無条件で再検索させると、非表示側の応答が後から`activeSearchView`を
  // 奪い、検索結果（件数）が非表示側に届いてしまう不具合が実機で確認されたため。
  getSidebarTocView()?.webContents.send('search-cleared', {
    previousTabId,
    newTabId,
    restoredText,
    isActiveView: activeSearchView === 'toc'
  })
  getSearchFloatView()?.webContents.send('search-cleared', {
    previousTabId,
    newTabId,
    restoredText,
    isActiveView: activeSearchView === 'float'
  })
  currentActiveTabId = newTabId
}

/**
 * 本文Viewへのフォーカス強制復帰（FR-004・FR-005の実現手段）。`searchInUse`が`true`の間のみ
 * 本文Viewの`focus`イベントで`activeSearchView`が指すViewへフォーカスを戻す（FR-011）。
 * リスナー自体は一度だけ登録し、内部で`searchInUse`を見て有効/無効を切り替える。
 */
function attachContentFocusForceback(): void {
  if (contentFocusForcebackAttached) {
    return
  }
  const content = getContentView()
  if (!content) {
    return
  }
  content.webContents.on('focus', () => {
    if (!searchInUse) {
      return
    }
    getActiveSearchWebContentsView()?.webContents.focus()
  })
  contentFocusForcebackAttached = true
}

/**
 * webContentsの`found-in-page`イベントを`find-in-page-result`として、直近に検索操作を
 * 行ったView（TOCサイドバーView or フロート検索View）へ中継する（FR-002）。
 * ウィンドウ生成後に一度だけ呼び出す。
 */
export function setupFoundInPageRelay(): void {
  const content = getContentView()
  content?.webContents.on('found-in-page', (_event, result) => {
    const payload: FindInPageResultPayload = {
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches
    }
    getActiveSearchWebContentsView()?.webContents.send('find-in-page-result', payload)
  })
  attachContentFocusForceback()
}

let handlersRegistered = false

/**
 * レンダラーからのIPCリクエストを処理するハンドラー群を登録する。
 */
export function registerIpcHandlers(): void {
  if (handlersRegistered) {
    return
  }
  handlersRegistered = true

  ipcMain.on('open-file', (_event, request: OpenFileRequest) => {
    void handleOpenFile(request.filePath)
  })

  // ---- ページ内検索（FR-002, FR-003, contracts/ipc-contract-delta.md） ----
  ipcMain.on('find-in-page', (event, request: FindInPageRequest) => {
    const view = resolveSearchViewFromSenderId(event.sender.id)
    if (view) {
      activeSearchView = view
    }
    getContentView()?.webContents.findInPage(request.text, {
      forward: request.forward,
      findNext: request.findNext
    })
  })

  ipcMain.on('stop-find-in-page', (_event, request: StopFindInPageRequest) => {
    getContentView()?.webContents.stopFindInPage(request.action)
  })

  // ---- フォーカス強制復帰（FR-011） ----
  ipcMain.on('search-focus-state-changed', (_event, request: SearchFocusStateChangedRequest) => {
    searchInUse = request.inUse
    if (request.inUse) {
      activeSearchView = request.view
    }
  })

  // ---- タブ単位の検索文字列をmainプロセスへ集約（実機フィードバック対応） ----
  ipcMain.on('search-text-changed', (_event, request: SearchTextChangedRequest) => {
    searchTextByTabId.set(request.tabId, request.text)
  })

  // ---- PageUp/PageDown転送（FR-012） ----
  ipcMain.on('scroll-content', (_event, request: ScrollContentRequest) => {
    getContentView()?.webContents.send('scroll-content', request)
  })

  // ---- TOCクリック→本文スクロールジャンプ（FR-008） ----
  ipcMain.on('navigate-to-heading', (_event, request: NavigateToHeadingRequest) => {
    getContentView()?.webContents.send('navigate-to-heading', request)
  })

  // ---- 本文View→TOCサイドバーViewへの見出しリスト通知 ----
  ipcMain.on('heading-list-updated', (_event, payload: HeadingListUpdatedPayload) => {
    getSidebarTocView()?.webContents.send('heading-list-updated', payload)
  })

  // ---- raw/rendered表示切替（FR-007） ----
  ipcMain.on('toggle-display-mode', (_event, request: ToggleDisplayModeRequest) => {
    getContentView()?.webContents.send('toggle-display-mode', request)
  })
  ipcMain.on('display-mode-changed', (_event, payload: DisplayModeChangedPayload) => {
    getTabBarView()?.webContents.send('display-mode-changed', payload)
  })

  // ---- タブ作成の不整合検知（data-model.md Validation Rules） ----
  ipcMain.on('tab-content-created-ack', (_event, payload: { tabId: string }) => {
    acknowledgeTabContentCreated(payload.tabId)
  })

  // ---- ファイル読み込み完了通知（本文View→タブバーView、タブのローディング表示解除・FR-034） ----
  ipcMain.on('tab-loaded', (_event, payload: { tabId: string }) => {
    getTabBarView()?.webContents.send('tab-loaded', payload)
  })

  // ---- タブバーViewでのタブクリック→本文Viewのアクティブ化（FR-008, FR-009） ----
  ipcMain.on('activate-tab', (_event, payload: ActivateTabContentPayload) => {
    clearSearchOnTabSwitch(payload.tabId)
    getContentView()?.webContents.send('activate-tab-content', payload)
  })

  // ---- フロート検索の開閉（research.md Decision 1a） ----
  ipcMain.on('open-search-float', () => {
    const win = getMainWindow()
    if (win) {
      openSearchFloatView(win)
    }
  })
  ipcMain.on('close-search-float', () => {
    closeSearchFloatView()
    searchInUse = false
  })

  /**
   * Ctrl+F押下時、TOCサイドバー表示中はTOC内検索へ、非表示中はフロート検索を開く
   * （既存`029-tab-toc-improvements` FR-011, FR-012の判定をmainプロセス側に集約し、
   * 本文View・タブバーViewいずれからのCtrl+Fでも同じ判定結果になるようにする）。
   */
  ipcMain.on('request-search-focus', () => {
    const win = getMainWindow()
    if (!win) {
      return
    }
    if (getAppSettings().tocVisible) {
      const view = getSidebarTocView()
      // rendererからのinputEl.focus()はDOM上のフォーカスに過ぎず、OSレベルで
      // このView自体がキーボードフォーカスを持っていないと実際の入力は届かない
      view?.webContents.focus()
      view?.webContents.send('focus-sidebar-search')
    } else {
      openSearchFloatView(win)
    }
  })

  /**
   * F3/Shift+F3による次/前候補移動を、フォーカス位置に関わらずどのViewからでも
   * 受け付ける（実機フィードバック対応）。現在アクティブなタブの検索文字列
   * （`searchTextByTabId`）を用いて`findNext: false`（既存セッションの続行）で検索する。
   * 検索文字列が空（一度も検索していない）の場合は何もしない。
   */
  ipcMain.on('request-find-next', (_event, request: RequestFindNextRequest) => {
    const text = currentActiveTabId !== null ? (searchTextByTabId.get(currentActiveTabId) ?? '') : ''
    if (!text) {
      return
    }
    getContentView()?.webContents.findInPage(text, { forward: request.forward, findNext: false })
  })

  ipcMain.handle('get-app-settings', () => getAppSettings())

  ipcMain.on('theme-changed', (_event, request: ThemeChangedRequest) => {
    setAppSettings({ ...getAppSettings(), theme: request.theme })
    refreshAppMenu()
    broadcastToAllViews('theme-updated', request)
  })

  ipcMain.on('toc-visibility-changed', (_event, request: TocVisibilityChangedRequest) => {
    setAppSettings({ ...getAppSettings(), tocVisible: request.visible })
    refreshAppMenu()
    const win = getMainWindow()
    if (win) {
      relayoutViews(win)
      handleTocVisibilityChangeForSearch(request.visible, win)
    }
  })

  ipcMain.on('toc-width-changed', (_event, request: TocWidthChangedRequest) => {
    setAppSettings({ ...getAppSettings(), tocWidth: request.width })
    const win = getMainWindow()
    if (win) {
      relayoutViews(win)
    }
  })

  ipcMain.on('content-width-mode-changed', (_event, request: ContentWidthModeChangedRequest) => {
    setAppSettings({ ...getAppSettings(), contentWidthMode: request.mode })
    refreshAppMenu()
    broadcastToAllViews('content-width-mode-updated', request)
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

/**
 * テーマ・本文表示幅モード等、複数View共通の設定変更を4View全てへブロードキャストする
 * （research.md Decision 6）。フロート検索Viewは閉じている間`null`のため自動的に除外される。
 */
function broadcastToAllViews(channel: string, payload: unknown): void {
  for (const view of [getTabBarView(), getSidebarTocView(), getSearchFloatView(), getContentView()]) {
    view?.webContents.send(channel, payload)
  }
}
