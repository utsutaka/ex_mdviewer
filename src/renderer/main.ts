import DOMPurify from 'dompurify'
import { showToast } from './components/toast'
import { showFatalErrorModal } from './components/modal'
import { parseDocument, renderTokensChunked } from './markdown/render'
import { extractHeadingsFromTokens } from './markdown/toc'
import { getTocVisible, initTocVisible, renderToc, scrollToHeading, setTocVisible } from './components/sidebar-toc'
import { closeSearchBar, isSearchBarOpen, openSearchBar } from './components/search-bar'
import { applyMermaidTheme, renderMermaidBlocks } from './markdown/mermaid'
import { getTheme, initTheme, onThemeChange, setTheme } from './theme/theme-manager'
import {
  getContentWidthMode,
  initContentWidthMode,
  setContentWidthMode
} from './content-width/content-width-manager'
import {
  addTab,
  firstTabId,
  focusTabUi,
  initTabBar,
  markTabLoaded,
  removeTab,
  setActiveTabUi,
  setTabDisplayModeUi
} from './components/tab-bar'
import type {
  FileKind,
  FileOpenedPayload,
  FocusTabPayload,
  Heading,
  PdfPageInfoPayload,
  TabCreatedPayload
} from '@shared/types'
import { resolveFileKind } from '@shared/file-kind'
import { toStructuredNodeFromJson } from './structured-data/json-adapter'
import { toStructuredNodeFromXml } from './structured-data/xml-adapter'
import { renderStructuredTree } from './structured-data/tree-viewer'
import { renderHtmlDocumentInto } from './html-view/render-html'
import { renderPdfDocumentInto, updatePdfPageIndicator } from './pdf-view/render-pdf'
import { resolveContainerClassName } from './tab-container'
import { isRawToggleSupported, renderRawSourceInto } from './raw-source/render-raw'

/** Markdown/HTMLタブの表示モード（レンダリング表示⇔生データ表示、019-raw-source-toggle FR-001〜FR-004） */
export type DisplayMode = 'rendered' | 'raw'

export interface TabRuntime {
  tabId: string
  filePath: string
  title: string
  containerEl: HTMLDivElement
  headings: Heading[]
  fileKind: FileKind
  /** 表示モード（FR-001〜FR-008）。markdown/html以外のfileKindでは常に'rendered'のまま未使用 */
  displayMode: DisplayMode
  /** raw表示に用いる元テキスト（FR-002, FR-007）。file-opened/file-changed受信時にpayload.rawContentを複製する */
  rawSourceText: string
}

const tabs = new Map<string, TabRuntime>()
let activeTabId = ''

function getContentRoot(): HTMLElement {
  const el = document.getElementById('content')
  if (!el) {
    throw new Error('content root element not found')
  }
  return el
}

/**
 * コンテンツペイン・タブバーUI・TOCサイドバーを指定タブへ切り替える。
 * PDFタブについては、ページ位置ポーリング（FR-018）の開始・停止をmainプロセスへ通知する。
 * タブクローズによる切替の場合は`closeTab()`で対象タブが既に`tabs`から削除されているため
 * ここでの非アクティブ通知は送られないが、main側の`handleCloseTab()`が独立して
 * ポーリング停止を行うため通知漏れは生じない（contracts/ipc-contract-delta.md）。
 */
function setActiveTab(tabId: string): void {
  const previousActiveTabId = activeTabId
  activeTabId = tabId
  for (const [id, tab] of tabs) {
    tab.containerEl.classList.toggle('is-active', id === tabId)
  }
  setActiveTabUi(tabId)

  if (previousActiveTabId && previousActiveTabId !== tabId) {
    const previousTab = tabs.get(previousActiveTabId)
    if (previousTab?.fileKind === 'pdf') {
      window.api.notifyPdfTabActiveChanged({ tabId: previousActiveTabId, active: false })
    }
  }

  const tab = tabs.get(tabId)
  if (tab) {
    // raw表示中はTOC項目のクリックによるジャンプを無効化する（019-raw-source-toggle FR-012）
    void renderToc(tab.headings, tab.containerEl, tab.displayMode !== 'raw')
    if (tab.fileKind === 'pdf') {
      window.api.notifyPdfTabActiveChanged({ tabId, active: true })
    }
  }
}

/** タブのクローズ（001-core-viewer FR-026, FR-027） */
async function closeTab(tabId: string): Promise<void> {
  const response = await window.api.closeTab(tabId)

  tabs.get(tabId)?.containerEl.remove()
  tabs.delete(tabId)
  removeTab(tabId)

  if (response.windowClosed) {
    return
  }

  if (activeTabId === tabId) {
    const nextId = firstTabId()
    if (nextId) {
      setActiveTab(nextId)
    }
  }
}

function initTabBarUi(): void {
  initTabBar({
    onActivate: (tabId) => {
      setActiveTab(tabId)
    },
    onClose: (tabId) => {
      void closeTab(tabId)
    },
    onToggleDisplayMode: (tabId) => {
      toggleDisplayMode(tabId)
    }
  })
}

/**
 * 本文内の文書内リンク（`href="#..."`）のクリックを横取りし、自タブ内の見出しへスクロールする。
 * ブラウザ標準のアンカー遷移に任せると、複数タブが同一document内に共存する構成上、
 * 他タブの同名アンカーへ誤ってジャンプする可能性があるため、サイドバーTOCと同じ確実な方式
 * （querySelectorをタブのcontainerElスコープに限定）に統一する（007-fix-body-link-jump FR-003, FR-004, FR-007, FR-008）。
 * containerEl自体はタブの再描画（innerHTML=''）でも再生成されないため、登録はタブ生成時の1回のみでよい。
 */
function initInBodyLinkJump(containerEl: HTMLDivElement): void {
  containerEl.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    const link = target.closest('a[href^="#"]')
    if (!link) {
      return
    }
    const rawAnchorId = link.getAttribute('href')?.slice(1) ?? ''
    if (!rawAnchorId) {
      return
    }
    // markdown-itはリンクURLをパーセントエンコードして出力するため、
    // 見出しの実IDと比較する前に元の文字列へ復元する（007-fix-body-link-jump）
    let anchorId = rawAnchorId
    try {
      anchorId = decodeURIComponent(rawAnchorId)
    } catch {
      // 不正なエンコーディングの場合は元の文字列のまま比較する（一致せず何も起きない、FR-008）
    }
    event.preventDefault()
    scrollToHeading(anchorId, containerEl)
  })
}

function resolveLoadingClassName(fileKind: FileKind): string {
  if (fileKind === 'markdown' || fileKind === 'html') {
    return 'document-pane__loading'
  }
  if (fileKind === 'pdf') {
    return 'pdf-pane__loading'
  }
  return 'structured-tree__empty-message'
}

/** タブが生成された直後、読み込み完了を待たずタブ領域を追加する（FR-034） */
function initTabCreatedListener(): void {
  window.api.onTabCreated((payload: TabCreatedPayload) => {
    const fileKind = resolveFileKind(payload.filePath) ?? 'markdown'
    const containerEl = document.createElement('div')
    containerEl.className = resolveContainerClassName(fileKind)
    containerEl.dataset.tabId = payload.tabId
    if (fileKind === 'markdown') {
      initInBodyLinkJump(containerEl)
    }

    const loading = document.createElement('div')
    loading.className = resolveLoadingClassName(fileKind)
    loading.textContent = '読み込み中...'
    containerEl.appendChild(loading)

    getContentRoot().appendChild(containerEl)
    tabs.set(payload.tabId, {
      tabId: payload.tabId,
      filePath: payload.filePath,
      title: payload.title,
      containerEl,
      headings: [],
      fileKind,
      // 新規タブの初期表示モードは常にレンダリング表示（019-raw-source-toggle FR-008）
      displayMode: 'rendered',
      rawSourceText: ''
    })
    addTab(payload.tabId, payload.filePath, payload.title, fileKind)
    setActiveTab(payload.tabId)
  })
}

/** 同一ファイルの重複オープン要求時、既存タブへフォーカスする（FR-038） */
function initFocusTabListener(): void {
  window.api.onFocusTab((payload: FocusTabPayload) => {
    if (!tabs.has(payload.tabId)) {
      return
    }
    setActiveTab(payload.tabId)
    focusTabUi(payload.tabId)
  })
}

/**
 * パースを一度だけ行い、見出し抽出・TOC描画・チャンク分割描画・Mermaid検出で
 * トークン列を共有する。大容量ファイルで多重の同期パースが走ると長時間の
 * メインスレッド占有につながるため、これを避ける（FR-015, SC-008, SC-010）。
 * 例外時はベストエフォート表示＋トースト通知を行う（FR-016）。
 */
async function renderDocumentInto(tab: TabRuntime, rawContent: string): Promise<void> {
  tab.containerEl.innerHTML = ''
  try {
    const { tokens, env } = parseDocument(rawContent)

    // 見出し抽出はrenderer側のみで完結する（main側のfile-opened/file-changedペイロードは常に空配列、FR-003）
    tab.headings = extractHeadingsFromTokens(tokens)
    if (tab.tabId === activeTabId) {
      void renderToc(tab.headings, tab.containerEl)
    }

    await renderTokensChunked(tokens, env, (html) => {
      // markdown-itはhtml:falseで生HTML混入を防いでいるが、多層防御としてDOMPurifyでも検疫する
      tab.containerEl.insertAdjacentHTML('beforeend', DOMPurify.sanitize(html))
    })
    // Mermaidブロックの描画はHTML挿入完了後、DOM上のcode.language-mermaidを対象に行う（FR-020）
    renderMermaidBlocks(tab.containerEl, tokens)
  } catch {
    showToast(
      'Markdownの解析中にエラーが発生しました。可能な範囲で表示しています。',
      'error'
    )
  }
}

/** パース失敗時、ツリー化を行わず生テキストへフォールバック表示する（FR-010） */
function showStructuredParseErrorFallback(tab: TabRuntime, rawContent: string): void {
  const pre = document.createElement('pre')
  pre.className = 'structured-tree__fallback'
  pre.textContent = rawContent
  tab.containerEl.appendChild(pre)
  showToast('構文の解析に失敗しました。テキストとして表示しています。', 'error')
}

/**
 * JSON/YAML/XML共通の適用処理。空ファイルチェック（FR-016）を共通処理として先に行い、
 * それ以降はfileKindごとにパース・ツリー描画・パースエラーフォールバックを分岐する
 * （010-json-yaml-xml-viewer research.md Decision 9）。
 */
async function renderStructuredDocumentInto(tab: TabRuntime, payload: FileOpenedPayload): Promise<void> {
  tab.containerEl.innerHTML = ''

  if (payload.rawContent === '') {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'structured-tree__empty-message'
    emptyEl.textContent = '空のファイルです'
    tab.containerEl.appendChild(emptyEl)
    return
  }

  if (tab.fileKind === 'json') {
    try {
      const parsed: unknown = JSON.parse(payload.rawContent)
      const root = toStructuredNodeFromJson(parsed)
      await renderStructuredTree(root, tab.containerEl)
    } catch {
      showStructuredParseErrorFallback(tab, payload.rawContent)
    }
    return
  }

  if (tab.fileKind === 'yaml') {
    if (payload.structuredParseError || payload.yamlDocuments === null) {
      showStructuredParseErrorFallback(tab, payload.rawContent)
      return
    }
    if (payload.yamlDocuments.length > 1) {
      for (const group of payload.yamlDocuments) {
        const heading = document.createElement('div')
        heading.className = 'sdv-doc-heading'
        heading.textContent = group.label
        tab.containerEl.appendChild(heading)
        await renderStructuredTree(group.root, tab.containerEl)
      }
    } else {
      await renderStructuredTree(payload.yamlDocuments[0].root, tab.containerEl)
    }
    return
  }

  if (tab.fileKind === 'xml') {
    const doc = new DOMParser().parseFromString(payload.rawContent, 'application/xml')
    if (doc.querySelector('parsererror')) {
      showStructuredParseErrorFallback(tab, payload.rawContent)
      return
    }
    const root = toStructuredNodeFromXml(doc.documentElement)
    await renderStructuredTree(root, tab.containerEl)
  }
}

/**
 * file-opened/file-changed共通の適用処理。あるタブの読み込みが他タブの表示を
 * ブロックしないことを保証する（FR-034）。fileKindに応じてMarkdownパイプライン
 * （見出し抽出・TOC描画・本文内アンカージャンプ）またはJSON/YAML/XMLツリー表示へ分岐する
 * （010-json-yaml-xml-viewer research.md Decision 9, spec.md FR-011）。
 * markdown/htmlタブについては、raw表示への切替に備えて元テキストをtab.rawSourceTextへ
 * 複製する（019-raw-source-toggle FR-002, FR-007）。表示モードがraw中の場合は
 * レンダリングパイプラインを呼ばずraw表示のみを更新する。この複製・分岐はfile-opened/
 * file-changedのいずれでも同一のこの関数を通るため、非アクティブタブのライブリロードでも
 * 即座に反映される（FR-009）。
 */
function applyDocumentPayload(payload: FileOpenedPayload): void {
  const tab = tabs.get(payload.tabId)
  if (!tab) {
    return
  }
  tab.fileKind = payload.fileKind
  markTabLoaded(payload.tabId)

  const rawTogglable = isRawToggleSupported(tab.fileKind)
  if (rawTogglable) {
    tab.rawSourceText = payload.rawContent
  }

  if (rawTogglable && tab.displayMode === 'raw') {
    renderRawSourceInto(tab.containerEl, tab.rawSourceText)
    if (tab.tabId === activeTabId) {
      void renderToc(tab.headings, tab.containerEl, false)
    }
  } else if (tab.fileKind === 'markdown') {
    void renderDocumentInto(tab, payload.rawContent)
  } else if (tab.fileKind === 'html') {
    renderHtmlDocumentInto(tab, payload, tab.tabId === activeTabId)
  } else if (tab.fileKind === 'pdf') {
    // tab.headingsは初期値の空配列のまま更新しない。既存renderToc()のheadings.length===0
    // 早期returnガードにより、追加実装なしでFR-009（PDFタブでのTOC非表示）が満たされる
    renderPdfDocumentInto(tab, payload)
  } else {
    void renderStructuredDocumentInto(tab, payload)
  }

  if (payload.encodingStatus === 'unrecognized') {
    showToast(
      'エンコーディングを認識できませんでした。文字化けする場合があります。',
      'error'
    )
  }
}

/**
 * raw表示切替ボタンのクリック時、対象タブの表示モードを反転させる（019-raw-source-toggle
 * FR-001, FR-006, FR-007）。対象タブのみを操作し、他タブの表示・状態には一切触れない。
 * HTML表示への復帰は、既存の`renderHtmlDocumentInto`が要求する`FileOpenedPayload`のうち
 * 実際に参照される`rawContent`・`isEmptyFile`のみを`tab.rawSourceText`から組み立てて渡す
 * （他フィールドは既存実装で未参照のためダミー値でよい）。
 */
function toggleDisplayMode(tabId: string): void {
  const tab = tabs.get(tabId)
  if (!tab || !isRawToggleSupported(tab.fileKind)) {
    return
  }

  tab.displayMode = tab.displayMode === 'raw' ? 'rendered' : 'raw'
  setTabDisplayModeUi(tabId, tab.displayMode)

  if (tab.displayMode === 'raw') {
    renderRawSourceInto(tab.containerEl, tab.rawSourceText)
    if (tab.tabId === activeTabId) {
      void renderToc(tab.headings, tab.containerEl, false)
    }
    return
  }

  if (tab.fileKind === 'markdown') {
    void renderDocumentInto(tab, tab.rawSourceText)
  } else if (tab.fileKind === 'html') {
    const payload: FileOpenedPayload = {
      tabId: tab.tabId,
      filePath: tab.filePath,
      rawContent: tab.rawSourceText,
      encodingStatus: 'utf-8',
      headings: [],
      loadStatus: 'loaded',
      fileKind: 'html',
      yamlDocuments: null,
      structuredParseError: false,
      isEmptyFile: tab.rawSourceText === '',
      isInvalidPdf: false
    }
    renderHtmlDocumentInto(tab, payload, tab.tabId === activeTabId)
  }
}

function initFileOpenedListener(): void {
  window.api.onFileOpened((payload: FileOpenedPayload) => {
    applyDocumentPayload(payload)
  })
}

/** ライブリロード：外部変更の再読込・再描画（FR-008） */
function initFileChangedListener(): void {
  window.api.onFileChanged((payload: FileOpenedPayload) => {
    applyDocumentPayload(payload)
  })
}

/** ライブリロード：削除・リネーム・到達不能の通知（表示内容は保持、FR-018） */
function initFileMissingListener(): void {
  window.api.onFileMissing(() => {
    showToast('ファイルが見つかりません', 'error')
  })
}

function initUnsupportedFileListener(): void {
  window.api.onUnsupportedFile(() => {
    showToast('非対応形式です', 'error')
  })
}

/** HTML5 Drag and Dropでファイルを開く（FR-001） */
function initDragAndDrop(): void {
  window.addEventListener('dragover', (event) => {
    event.preventDefault()
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) {
      return
    }
    for (const file of Array.from(files)) {
      const filePath = window.api.getPathForFile(file)
      window.api.openFile(filePath)
    }
  })
}

/** Ctrl+Fで検索バーを開く/フォーカスする（FR-005） */
function initSearchShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearchBar()
    } else if (event.key === 'Escape' && isSearchBarOpen()) {
      closeSearchBar()
    }
  })
}

/** Ctrl+マウスホイールによる表示拡大・縮小（50%〜300%、10%刻み、FR-006） */
function initZoom(): void {
  let zoomPercent = 100
  const contentRoot = getContentRoot()

  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) {
        return
      }
      event.preventDefault()
      const step = event.deltaY < 0 ? 10 : -10
      zoomPercent = Math.min(300, Math.max(50, zoomPercent + step))
      contentRoot.style.setProperty('zoom', `${zoomPercent}%`)
    },
    { passive: false }
  )
}

/** 設定破損からの復旧通知（FR-033） */
function initSettingsResetListener(): void {
  window.api.onSettingsReset(() => {
    showToast('設定がリセットされました', 'info')
  })
}

/** mainプロセスの捕捉されない例外の通知（FR-036） */
function initFatalErrorListener(): void {
  window.api.onFatalError((message) => {
    showFatalErrorModal(message)
  })
}

/** 「設定を保存する」切替失敗の通知（005-native-menu-save-toggle FR-012） */
function initSettingsPersistenceErrorListener(): void {
  window.api.onSettingsPersistenceError((payload) => {
    showToast(payload.message, 'error')
  })
}

/** ネイティブメニュー「表示」＞テーマ切替要求（005-native-menu-save-toggle FR-003） */
function initMenuThemeToggleListener(): void {
  window.api.onMenuThemeToggleRequested(() => {
    const next = getTheme() === 'dark' ? 'light' : 'dark'
    setTheme(next)
  })
}

/** ネイティブメニュー「表示」＞目次表示切替要求（005-native-menu-save-toggle FR-003） */
function initMenuTocVisibilityToggleListener(): void {
  window.api.onMenuTocVisibilityToggleRequested(() => {
    setTocVisible(!getTocVisible())
  })
}

/** ネイティブメニュー「編集」＞本文表示幅切替要求（013-content-width-toggle FR-004, FR-009） */
function initMenuContentWidthToggleListener(): void {
  window.api.onMenuContentWidthToggleRequested(() => {
    setContentWidthMode(getContentWidthMode() === 'full' ? 'readable' : 'full')
  })
}

/** 外部リンクのOS既定ブラウザ起動失敗の通知（008-fix-external-link-nav FR-002, SC-007） */
function initExternalLinkOpenFailedListener(): void {
  window.api.onExternalLinkOpenFailed(() => {
    showToast('リンクを開けませんでした', 'error')
  })
}

/** ネイティブメニュー「ファイル」＞「ファイルを開く...」ダイアログ表示失敗の通知（009-native-menu-file-edit Convergence T010、Constitution V） */
function initOpenFileDialogErrorListener(): void {
  window.api.onOpenFileDialogError((payload) => {
    showToast(payload.message, 'error')
  })
}

/** PDFページ位置情報の通知（011-html-pdf-viewer FR-017） */
function initPdfPageInfoListener(): void {
  window.api.onPdfPageInfo((payload: PdfPageInfoPayload) => {
    const tab = tabs.get(payload.tabId)
    if (!tab) {
      return
    }
    updatePdfPageIndicator(tab.containerEl, payload)
  })
}

async function init(): Promise<void> {
  const settings = await window.api.getAppSettings()
  initTheme(settings.theme)
  applyMermaidTheme(settings.theme === 'dark' ? 'dark' : 'default')
  onThemeChange((theme) => applyMermaidTheme(theme === 'dark' ? 'dark' : 'default'))
  initTocVisible(settings.tocVisible)
  initContentWidthMode(settings.contentWidthMode)

  initSettingsResetListener()
  initFatalErrorListener()
  initSettingsPersistenceErrorListener()
  initMenuThemeToggleListener()
  initMenuTocVisibilityToggleListener()
  initMenuContentWidthToggleListener()
  initExternalLinkOpenFailedListener()
  initOpenFileDialogErrorListener()
  initPdfPageInfoListener()
  initTabBarUi()
  initTabCreatedListener()
  initFocusTabListener()
  initFileOpenedListener()
  initFileChangedListener()
  initFileMissingListener()
  initUnsupportedFileListener()
  initDragAndDrop()
  initSearchShortcut()
  initZoom()
}

void init()
