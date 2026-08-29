import DOMPurify from 'dompurify'
import { showToast } from './components/toast'
import { showFatalErrorModal } from './components/modal'
import { parseDocument, renderTokensChunked } from './markdown/render'
import { extractHeadingsFromTokens } from './markdown/toc'
import { applyMermaidTheme, renderMermaidBlocks } from './markdown/mermaid'
import {
  getContentWidthMode,
  initContentWidthMode,
  setContentWidthMode
} from './content-width/content-width-manager'
import type {
  ActivateTabContentPayload,
  DisplayMode,
  FileKind,
  FileOpenedPayload,
  Heading,
  NavigateToHeadingRequest,
  PdfPageInfoPayload,
  ScrollContentRequest,
  TabContentClosedPayload,
  TabContentCreatedPayload,
  ToggleDisplayModeRequest
} from '@shared/types'
import { resolveFileKind } from '@shared/file-kind'
import { toStructuredNodeFromJson } from './structured-data/json-adapter'
import { toStructuredNodeFromXml } from './structured-data/xml-adapter'
import { renderStructuredTree } from './structured-data/tree-viewer'
import { renderHtmlDocumentInto } from './html-view/render-html'
import { renderPdfDocumentInto, updatePdfPageIndicator } from './pdf-view/render-pdf'
import { resolveContainerClassName } from './tab-container'
import { isRawToggleSupported, renderRawSourceInto } from './raw-source/render-raw'

export interface TabRuntime {
  tabId: string
  filePath: string
  containerEl: HTMLDivElement
  headings: Heading[]
  fileKind: FileKind
  /** 表示モード（レンダリング表示⇔生データ表示、019-raw-source-toggle FR-001〜FR-004） */
  displayMode: DisplayMode
  /** raw表示に用いる元テキスト（FR-002, FR-007） */
  rawSourceText: string
}

/**
 * 033-webcontentsview-search-fix: TabContentCache（data-model.md）。非アクティブ化時は
 * `containerEl`をDOMツリーから`removeChild`で切り離すが、このMapからは参照され続ける
 * （デタッチ済みノードは`findInPage`の対象に含まれないことを実機検証済み、research.md
 * Decision 2）。再アクティブ化時はキャッシュ済みノードを`appendChild`で再アタッチし、
 * Markdownの再パース・再レンダリングを避ける（FR-009）。
 */
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
 * アクティブタブを切り替える。非アクティブ化されるタブのDOMノードをデタッチし、
 * アクティブ化されるタブのDOMノードを（キャッシュ済みであれば再生成せず）再アタッチする
 * （FR-009、research.md Decision 2）。PDFタブについては、ページ位置ポーリングの
 * 開始・停止をmainプロセスへ通知する（FR-016）。
 */
function activateTab(tabId: string): void {
  const previousActiveTabId = activeTabId
  activeTabId = tabId
  const root = getContentRoot()

  if (previousActiveTabId && previousActiveTabId !== tabId) {
    const previousTab = tabs.get(previousActiveTabId)
    if (previousTab) {
      previousTab.containerEl.classList.remove('is-active')
      if (previousTab.containerEl.parentNode) {
        root.removeChild(previousTab.containerEl)
      }
      if (previousTab.fileKind === 'pdf') {
        window.contentApi.notifyPdfTabActiveChanged({ tabId: previousActiveTabId, active: false })
      }
    }
  }

  const tab = tabs.get(tabId)
  if (tab) {
    if (!tab.containerEl.parentNode) {
      root.appendChild(tab.containerEl)
    }
    // 033-webcontentsview-search-fix: 既存CSS（.document-pane/.pdf-pane/.structured-tree
    // いずれも既定でdisplay: noneであり.is-activeクラスが付いて初めて表示される）を
    // DOMアタッチ/デタッチ方式でも維持する。デタッチ済みノードは非表示のままでよいが、
    // アタッチされる際は明示的にis-activeを付与しないと表示されない
    tab.containerEl.classList.add('is-active')
    if (tab.fileKind === 'pdf') {
      window.contentApi.notifyPdfTabActiveChanged({ tabId, active: true })
    }
    notifyHeadingListUpdated(tab, tab.displayMode !== 'raw')
  }
}

/** TOCサイドバーViewへ見出しリストの更新を通知する（既存`renderToc`直接呼び出しのIPC化） */
function notifyHeadingListUpdated(tab: TabRuntime, interactive: boolean): void {
  if (tab.tabId !== activeTabId) {
    return
  }
  window.contentApi.notifyHeadingListUpdated({ tabId: tab.tabId, headings: tab.headings, interactive })
}

/**
 * 指定アンカーIDの見出しへスクロールする。TOCクリック（`navigate-to-heading`IPC経由）と
 * 本文内リンク（`href="#..."`）クリックの両方から使う（View分離後、本文内リンクは
 * この関数を直接呼べるがTOCクリックはIPC経由になる、research.md Decision 4注記）。
 */
function scrollToHeading(anchorId: string, contentContainerEl: HTMLElement): void {
  if (!anchorId) {
    return
  }
  const target = contentContainerEl.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 本文内の文書内リンク（`href="#..."`）のクリックを横取りし、自タブ内の見出しへスクロールする。
 * querySelectorをタブのcontainerElスコープに限定することで、他タブの同名アンカーへの
 * 誤ジャンプを防ぐ（007-fix-body-link-jump FR-003, FR-004, FR-007, FR-008）。
 * 本文View内で完結する処理のためIPC化は不要（research.md Decision 4注記）。
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

/** `tab-content-created`受信時、TabContentCacheエントリを生成しDOMノードを準備する（FR-009） */
function initTabContentCreatedListener(): void {
  window.contentApi.onTabContentCreated((payload: TabContentCreatedPayload) => {
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

    tabs.set(payload.tabId, {
      tabId: payload.tabId,
      filePath: payload.filePath,
      containerEl,
      headings: [],
      fileKind,
      displayMode: 'rendered',
      rawSourceText: ''
    })
    activateTab(payload.tabId)
    window.contentApi.acknowledgeTabContentCreated(payload.tabId)
  })
}

/** `activate-tab-content`受信時（既存タブへのフォーカス、タブ切替）にアクティブ化する（FR-008, FR-009） */
function initActivateTabContentListener(): void {
  window.contentApi.onActivateTabContent((payload: ActivateTabContentPayload) => {
    if (!tabs.has(payload.tabId)) {
      return
    }
    activateTab(payload.tabId)
  })
}

/** `tab-content-closed`受信時、TabContentCacheエントリを破棄する（FR-013） */
function initTabContentClosedListener(): void {
  window.contentApi.onTabContentClosed((payload: TabContentClosedPayload) => {
    const tab = tabs.get(payload.tabId)
    if (!tab) {
      return
    }
    tab.containerEl.remove()
    tabs.delete(payload.tabId)
    if (activeTabId === payload.tabId) {
      activeTabId = ''
    }
  })
}

/**
 * パースを一度だけ行い、見出し抽出・TOC通知・チャンク分割描画・Mermaid検出で
 * トークン列を共有する（FR-015）。例外時はベストエフォート表示＋トースト通知を行う（FR-016）。
 */
async function renderDocumentInto(tab: TabRuntime, rawContent: string): Promise<void> {
  tab.containerEl.innerHTML = ''

  if (rawContent === '') {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'document-pane__empty-message'
    emptyEl.textContent = '空のファイルです'
    tab.containerEl.appendChild(emptyEl)

    tab.headings = []
    notifyHeadingListUpdated(tab, true)
    return
  }

  try {
    const { tokens, env } = parseDocument(rawContent)

    tab.headings = extractHeadingsFromTokens(tokens)
    notifyHeadingListUpdated(tab, true)

    await renderTokensChunked(tokens, env, (html) => {
      // markdown-itはhtml:falseで生HTML混入を防いでいるが、多層防御としてDOMPurifyでも検疫する
      tab.containerEl.insertAdjacentHTML('beforeend', DOMPurify.sanitize(html))
    })
    renderMermaidBlocks(tab.containerEl, tokens)
  } catch {
    showToast('Markdownの解析中にエラーが発生しました。可能な範囲で表示しています。', 'error')
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
 * ブロックしないことを保証する（FR-034）。デタッチ中（非アクティブ）のタブへの
 * ライブリロードもDOM更新自体は継続する（FR-015）。
 */
function applyDocumentPayload(payload: FileOpenedPayload): void {
  const tab = tabs.get(payload.tabId)
  if (!tab) {
    return
  }
  tab.fileKind = payload.fileKind

  const rawTogglable = isRawToggleSupported(tab.fileKind)
  if (rawTogglable) {
    tab.rawSourceText = payload.rawContent
  }

  if (rawTogglable && tab.displayMode === 'raw') {
    // 033-webcontentsview-search-fix: raw表示中もTOCの表示自体は維持し、クリックのみ
    // 無効化する（019-raw-source-toggle FR-012）。headingsを空にするとTOCサイドバー側が
    // 「見出しなし」と誤判定し目次自体が消えてしまう不具合が実機で確認された
    renderRawSourceInto(tab.containerEl, tab.rawSourceText)
    notifyHeadingListUpdated(tab, false)
  } else if (tab.fileKind === 'markdown') {
    void renderDocumentInto(tab, payload.rawContent)
  } else if (tab.fileKind === 'html') {
    renderHtmlDocumentInto(tab, payload, notifyHeadingListUpdated)
  } else if (tab.fileKind === 'pdf') {
    // tab.headingsは初期値の空配列のまま更新しない（PDFタブでのTOC非表示、FR-009相当）
    renderPdfDocumentInto(tab, payload)
  } else {
    void renderStructuredDocumentInto(tab, payload)
  }

  if (payload.encodingStatus === 'unrecognized') {
    showToast('エンコーディングを認識できませんでした。文字化けする場合があります。', 'error')
  }

  // 033-webcontentsview-search-fix: タブのローディングスピナー解除はタブバーViewの責務だが、
  // 読み込み完了はfile-opened受信（本文View側）でしか分からないためIPCで通知する
  window.contentApi.notifyTabLoaded(payload.tabId)
}

/**
 * タブバーViewからの`toggle-display-mode`要求を受け、表示モードを反転させる
 * （019-raw-source-toggle FR-001, FR-006, FR-007）。完了後`display-mode-changed`を
 * 送出し、連打時は処理中の要求を無視することで整合性を保つ
 * （contracts/ipc-contract-delta.md CHK007対応）。
 */
let toggleDisplayModeInProgress = new Set<string>()
function toggleDisplayMode(tabId: string): void {
  const tab = tabs.get(tabId)
  if (!tab || !isRawToggleSupported(tab.fileKind) || toggleDisplayModeInProgress.has(tabId)) {
    return
  }
  toggleDisplayModeInProgress.add(tabId)

  if (activeTabId !== tabId) {
    activateTab(tabId)
  }

  tab.displayMode = tab.displayMode === 'raw' ? 'rendered' : 'raw'

  if (tab.displayMode === 'raw') {
    // raw表示中もTOCの表示自体は維持し、クリックのみ無効化する（019-raw-source-toggle FR-012）
    renderRawSourceInto(tab.containerEl, tab.rawSourceText)
    notifyHeadingListUpdated(tab, false)
  } else if (tab.fileKind === 'markdown') {
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
    renderHtmlDocumentInto(tab, payload, notifyHeadingListUpdated)
  }

  window.contentApi.notifyDisplayModeChanged({ tabId, displayMode: tab.displayMode })
  toggleDisplayModeInProgress.delete(tabId)
}

function initToggleDisplayModeListener(): void {
  window.contentApi.onToggleDisplayMode((request: ToggleDisplayModeRequest) => {
    toggleDisplayMode(request.tabId)
  })
}

function initFileOpenedListener(): void {
  window.contentApi.onFileOpened((payload: FileOpenedPayload) => {
    applyDocumentPayload(payload)
  })
}

function initFileChangedListener(): void {
  window.contentApi.onFileChanged((payload: FileOpenedPayload) => {
    applyDocumentPayload(payload)
  })
}

function initFileMissingListener(): void {
  window.contentApi.onFileMissing(() => {
    showToast('ファイルが見つかりません', 'error')
  })
}

function initUnsupportedFileListener(): void {
  window.contentApi.onUnsupportedFile(() => {
    showToast('非対応形式です', 'error')
  })
}

/** HTML5 Drag and Dropでファイルを開く（FR-001, FR-014: 本文Viewでも受け付ける） */
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
      const filePath = window.contentApi.getPathForFile(file)
      window.contentApi.openFile(filePath)
    }
  })
}

/** TOCサイドバーViewからの`navigate-to-heading`要求を受けスクロールジャンプする（FR-008） */
function initNavigateToHeadingListener(): void {
  window.contentApi.onNavigateToHeading((request: NavigateToHeadingRequest) => {
    const tab = tabs.get(request.tabId)
    if (!tab) {
      return
    }
    if (activeTabId !== request.tabId) {
      activateTab(request.tabId)
    }
    scrollToHeading(request.anchorId, tab.containerEl)
  })
}

/** 検索欄フォーカス中のPageUp/PageDownによる本文スクロール（FR-012） */
function initScrollContentListener(): void {
  window.contentApi.onScrollContent((request: ScrollContentRequest) => {
    // 033-webcontentsview-search-fix: 実際にスクロール可能なのは`window`（body）ではなく
    // `#content`要素自体（overflow-y: auto）のため、windowをスクロールしても本文は
    // 動かない不具合が実機で確認された
    const root = getContentRoot()
    const amount = root.clientHeight * 0.9
    root.scrollBy({ top: request.direction === 'down' ? amount : -amount, behavior: 'auto' })
  })
}

/**
 * Ctrl+Fで検索欄を開く/フォーカスする（029-tab-toc-improvements FR-011, FR-012）。
 * TOC表示中かどうかの判定はmainプロセス側に集約する（`request-search-focus`ハンドラ）。
 * F3/Shift+F3は、フォーカスが検索欄以外（本文等）にあってもページ内検索の次/前候補へ
 * 移動できるようにする（実機フィードバック対応）。検索欄・移動ボタン自身のキー操作は
 * 各Viewの専用ハンドラが`preventDefault()`済みのため、`event.defaultPrevented`で
 * 二重発火を防ぐ。
 */
function initSearchShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      window.contentApi.requestSearchFocus()
    } else if (event.key === 'F3' && !event.defaultPrevented) {
      event.preventDefault()
      window.contentApi.requestFindNext(!event.shiftKey)
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

function initSettingsResetListener(): void {
  window.contentApi.onSettingsReset(() => {
    showToast('設定がリセットされました', 'info')
  })
}

function initFatalErrorListener(): void {
  window.contentApi.onFatalError((message) => {
    showFatalErrorModal(message)
  })
}

function initSettingsPersistenceErrorListener(): void {
  window.contentApi.onSettingsPersistenceError((payload) => {
    showToast(payload.message, 'error')
  })
}

function initExternalLinkOpenFailedListener(): void {
  window.contentApi.onExternalLinkOpenFailed(() => {
    showToast('リンクを開けませんでした', 'error')
  })
}

function initOpenFileDialogErrorListener(): void {
  window.contentApi.onOpenFileDialogError((payload) => {
    showToast(payload.message, 'error')
  })
}

function initTabContentCreationTimeoutListener(): void {
  window.contentApi.onTabContentCreationTimeout(() => {
    showToast('タブの初期化がタイムアウトしました', 'error')
  })
}

function initPdfPageInfoListener(): void {
  window.contentApi.onPdfPageInfo((payload: PdfPageInfoPayload) => {
    const tab = tabs.get(payload.tabId)
    if (!tab) {
      return
    }
    updatePdfPageIndicator(tab.containerEl, payload)
  })
}

/** テーマ・本文表示幅モードの4View共通配信を受信し反映する（research.md Decision 6） */
function initThemeAndWidthListeners(): void {
  window.contentApi.onThemeUpdated((theme) => {
    document.documentElement.classList.remove('theme-light', 'theme-dark')
    document.documentElement.classList.add(`theme-${theme}`)
    applyMermaidTheme(theme === 'dark' ? 'dark' : 'default')
  })
  // 033-webcontentsview-search-fix: `initContentWidthMode`（CSS適用のみ、IPC送出なし）を
  // 呼ぶこと。`setContentWidthMode`（IPC送出あり）を呼ぶと、
  // 本文View変更→main→4View配信→本文Viewが再受信→再送出…の無限ループになり
  // メインプロセスがフリーズしてネイティブメニューが応答しなくなる不具合が実機で確認された
  window.contentApi.onContentWidthModeUpdated((mode) => {
    initContentWidthMode(mode)
  })
}

/** ネイティブメニュー「編集」＞本文表示幅切替要求（013-content-width-toggle FR-004, FR-009） */
function initMenuContentWidthToggleListener(): void {
  window.contentApi.onMenuContentWidthToggleRequested(() => {
    setContentWidthMode(getContentWidthMode() === 'full' ? 'readable' : 'full')
  })
}

async function init(): Promise<void> {
  const settings = await window.contentApi.getAppSettings()
  document.documentElement.classList.add(`theme-${settings.theme}`)
  applyMermaidTheme(settings.theme === 'dark' ? 'dark' : 'default')
  initContentWidthMode(settings.contentWidthMode)

  initSettingsResetListener()
  initFatalErrorListener()
  initSettingsPersistenceErrorListener()
  initExternalLinkOpenFailedListener()
  initOpenFileDialogErrorListener()
  initTabContentCreationTimeoutListener()
  initPdfPageInfoListener()
  initTabContentCreatedListener()
  initActivateTabContentListener()
  initTabContentClosedListener()
  initFileOpenedListener()
  initFileChangedListener()
  initFileMissingListener()
  initUnsupportedFileListener()
  initToggleDisplayModeListener()
  initNavigateToHeadingListener()
  initScrollContentListener()
  initThemeAndWidthListeners()
  initMenuContentWidthToggleListener()
  initDragAndDrop()
  initSearchShortcut()
  initZoom()
}

void init()
