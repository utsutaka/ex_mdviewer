import type {
  FindInPageResultPayload,
  Heading,
  HeadingListUpdatedPayload,
  RestoreSearchTextPayload,
  SearchClearedPayload
} from '@shared/types'

/** TOCサイドバー下部の見出し一覧コンテナ（029-tab-toc-improvements FR-008, FR-010） */
function getSidebarListEl(): HTMLElement {
  const el = document.getElementById('sidebar-toc-list')
  if (!el) {
    throw new Error('sidebar-toc-list element not found')
  }
  return el
}

/** `heading-list-updated`で通知された、現在TOCが表示対象とするタブID */
let currentTabId = ''

/**
 * TOCサイドバーの見出しクリック時、本文Viewへスクロールジャンプを要求する
 * （033-webcontentsview-search-fix FR-008、既存`scrollToHeading`の直接DOM操作をIPC化）。
 */
function navigateToHeading(anchorId: string): void {
  if (!anchorId || !currentTabId) {
    return
  }
  window.sidebarTocApi.navigateToHeading({ tabId: currentTabId, anchorId })
}

/**
 * 見出しツリーからネストしたリストを構築する。見出し数が極端に多い文書でも
 * メインスレッドを長時間占有しないよう、一定件数ごとにイベントループへ処理を委譲する
 * （FR-015相当の防御的対応。通常の見出し数では実質的にawaitは発生しない）。
 */
async function buildListAsync(
  headings: Heading[],
  counter: { count: number },
  interactive: boolean
): Promise<HTMLUListElement> {
  const ul = document.createElement('ul')
  ul.setAttribute('role', 'group')

  for (const heading of headings) {
    const li = document.createElement('li')
    const link = document.createElement('a')
    link.href = `#${heading.anchorId}`
    link.textContent = heading.text
    // サイドバー幅縮小時にellipsisで省略される見出しでも全文を確認できるようにする（030-toc-width-tooltip FR-003, FR-004）
    link.title = heading.text
    link.setAttribute('role', 'treeitem')
    link.tabIndex = 0
    if (!interactive) {
      // raw表示中はTOCの表示自体を維持しつつ、クリック（キーボードのEnter経由も含む）を無効化する（019-raw-source-toggle FR-012）
      link.classList.add('toc-link--disabled')
    }
    link.addEventListener('click', (event) => {
      event.preventDefault()
      if (!interactive) {
        return
      }
      navigateToHeading(heading.anchorId)
    })
    li.appendChild(link)

    if (heading.children.length > 0) {
      li.appendChild(await buildListAsync(heading.children, counter, interactive))
    }
    ul.appendChild(li)

    counter.count += 1
    if (counter.count % 500 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  return ul
}

/**
 * 矢印キー・Enterによるキーボードのみでのジャンプ操作（FR-029）に加え、
 * roving tabindexパターンによりTabキーでは目次内を移動させず、目次外への
 * フォーカス離脱・進入のみをブラウザ標準のTab順に委ねる（023-toc-keyboard-nav FR-001〜FR-004）。
 * TOC内の↑↓キー移動は検索欄・移動ボタンの↑↓キー処理とは独立したキーイベント処理であり、
 * 共有のグローバルキーハンドラを介さないため互いに干渉しない（spec.md Edge Cases）。
 */
function initKeyboardNavigation(sidebar: HTMLElement): void {
  const links = Array.from(sidebar.querySelectorAll<HTMLAnchorElement>('a'))
  if (links.length === 0) {
    return
  }

  const focusLink = (nextIndex: number): void => {
    links.forEach((link) => {
      link.tabIndex = -1
    })
    const target = links[nextIndex]
    target.tabIndex = 0
    target.focus()
  }
  links.forEach((link, index) => {
    link.tabIndex = index === 0 ? 0 : -1
  })

  links.forEach((link, index) => {
    link.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusLink(Math.min(index + 1, links.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusLink(Math.max(index - 1, 0))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        link.click()
      }
    })
  })
}

/**
 * TOCサイドバーを再構築する（FR-003, FR-004）。`interactive: false`の場合、TOCの表示自体は
 * 維持しつつ項目クリックによるジャンプ操作のみを無効化する（019-raw-source-toggle FR-012）。
 */
async function renderToc(headings: Heading[], interactive: boolean): Promise<void> {
  const list = getSidebarListEl()
  list.innerHTML = ''
  if (headings.length === 0) {
    return
  }
  list.setAttribute('role', 'tree')
  const listEl = await buildListAsync(headings, { count: 0 }, interactive)
  list.appendChild(listEl)
  initKeyboardNavigation(list)
}

/** タブが1件もない状態になった際、TOCサイドバーを空にする（025-fix-toc-close-last-tab FR-001） */
function clearToc(): void {
  const list = getSidebarListEl()
  list.innerHTML = ''
}

function initHeadingListUpdatedListener(): void {
  window.sidebarTocApi.onHeadingListUpdated((payload: HeadingListUpdatedPayload) => {
    currentTabId = payload.tabId
    if (payload.headings.length === 0) {
      clearToc()
      return
    }
    void renderToc(payload.headings, payload.interactive)
  })
}

let tocVisible = true

function getTocVisible(): boolean {
  return tocVisible
}

/** TOCサイドバーの表示・非表示を切り替え、AppSettingsへ永続化する（003-toc-toggle FR-001, FR-005） */
function setTocVisible(visible: boolean): void {
  tocVisible = visible
  document.documentElement.classList.toggle('toc-hidden', !visible)
  window.sidebarTocApi.tocVisibilityChanged(visible)
}

function initTocVisible(initialVisible: boolean): void {
  tocVisible = initialVisible
  document.documentElement.classList.toggle('toc-hidden', !initialVisible)
}

const TOC_WIDTH_MIN = 150
const TOC_WIDTH_MAX = 480
const TOC_WIDTH_DEFAULT = 220

function clampTocWidth(width: number): number {
  return Math.min(TOC_WIDTH_MAX, Math.max(TOC_WIDTH_MIN, width))
}

function applyTocWidth(width: number): void {
  document.documentElement.style.setProperty('--toc-width', `${width}px`)
}

let tocWidth = TOC_WIDTH_DEFAULT

function setTocWidth(width: number): void {
  tocWidth = clampTocWidth(width)
  applyTocWidth(tocWidth)
  window.sidebarTocApi.tocWidthChanged(tocWidth)
}

function initTocWidth(initialWidth: number): void {
  tocWidth = clampTocWidth(initialWidth)
  applyTocWidth(tocWidth)
}

/**
 * リサイズハンドルへのドラッグ操作（Pointer Events）とダブルクリックによる既定幅リセットを配線する
 * （FR-002, FR-007, FR-008、research.md Decision 1, 3, 6）。
 */
function initTocResizeHandle(): void {
  const handle = document.getElementById('toc-resize-handle')
  if (!handle) {
    return
  }

  let dragStartX = 0
  let dragStartWidth = TOC_WIDTH_DEFAULT

  handle.addEventListener('pointerdown', (event) => {
    if (!getTocVisible()) {
      return
    }
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    dragStartX = event.clientX
    dragStartWidth = tocWidth
  })

  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return
    }
    applyTocWidth(clampTocWidth(dragStartWidth + (event.clientX - dragStartX)))
  })

  handle.addEventListener('pointerup', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return
    }
    handle.releasePointerCapture(event.pointerId)
    handle.classList.remove('is-dragging')
    setTocWidth(dragStartWidth + (event.clientX - dragStartX))
  })

  handle.addEventListener('dblclick', () => {
    if (!getTocVisible()) {
      return
    }
    setTocWidth(TOC_WIDTH_DEFAULT)
  })
}

// ---- TOCサイドバー内蔵検索（旧sidebar-search.ts、029-tab-toc-improvements） ----

let searchInputEl: HTMLInputElement | null = null
let searchCountEl: HTMLSpanElement | null = null
let searchClearBtnEl: HTMLButtonElement | null = null
let searchPrevBtn: HTMLButtonElement | null = null
let searchNextBtn: HTMLButtonElement | null = null
let searchInitialized = false

function getSearchContainerEl(): HTMLElement {
  const el = document.getElementById('sidebar-toc-search')
  if (!el) {
    throw new Error('sidebar-toc-search element not found')
  }
  return el
}

function updateSearchNavButtons(hasMatches: boolean): void {
  if (searchPrevBtn) {
    searchPrevBtn.disabled = !hasMatches
  }
  if (searchNextBtn) {
    searchNextBtn.disabled = !hasMatches
  }
}

function updateSearchCount(payload: FindInPageResultPayload): void {
  if (!searchCountEl) {
    return
  }
  searchCountEl.textContent = payload.matches === 0 ? '0/0' : `${payload.activeMatchOrdinal}/${payload.matches}`
  updateSearchNavButtons(payload.matches > 0)
}

/**
 * F3/Shift+F3による次候補・前候補移動（ブラウザの検索慣習に合わせる）。
 * 033-webcontentsview-search-fixで↑↓キーからF3/Shift+F3に変更した
 * （↑↓キーはElectronの制約で本文へのフォーカス移動により不安定になりやすく、
 * 実機フィードバックによりブラウザ標準のF3キーに統一した）。
 * `findNext`は既存の検索セッションを継続する（＝次/前候補へ移動する）ことを意味するため
 * `false`を渡す（`search`関数のコメント参照、実機ログで確認した実際のElectron仕様）。
 */
function handleSearchKeyNav(event: KeyboardEvent): void {
  if (event.key === 'F3') {
    event.preventDefault()
    search(!event.shiftKey, false)
  }
}

/**
 * `findNext`はElectronの`webContents.findInPage`の`options.findNext`にそのまま渡る値であり、
 * 直感に反して「新規セッションを開始するか」を意味する（`true`＝新規検索として最初の一致から
 * 開始、`false`＝既存セッションを継続し次/前候補へ移動）。実機ログで、`findNext:false`は
 * 直前に同一文字列のアクティブなセッションが存在しない限り`found-in-page`イベント自体が
 * 発火しないことを確認した。そのため、入力欄の値が変わるたび（新規検索）は`true`、
 * F3・Enter・▲▼ボタンによる同一文字列内の次/前候補移動は`false`を渡す。
 */
function search(forward: boolean, findNext: boolean): void {
  const text = searchInputEl?.value ?? ''
  if (currentTabId) {
    window.sidebarTocApi.searchTextChanged(currentTabId, text)
  }
  if (!text) {
    window.sidebarTocApi.stopFindInPage('clearSelection')
    if (searchCountEl) {
      searchCountEl.textContent = '0/0'
    }
    updateSearchNavButtons(false)
    setTimeout(() => searchInputEl?.focus(), 0)
    return
  }
  window.sidebarTocApi.findInPage(text, forward, findNext)
}

function updateSearchClearButtonVisibility(): void {
  if (!searchClearBtnEl) {
    return
  }
  searchClearBtnEl.hidden = !searchInputEl?.value
}

function clearSearch(): void {
  if (!searchInputEl) {
    return
  }
  searchInputEl.value = ''
  if (currentTabId) {
    window.sidebarTocApi.searchTextChanged(currentTabId, '')
  }
  window.sidebarTocApi.stopFindInPage('clearSelection')
  if (searchCountEl) {
    searchCountEl.textContent = '0/0'
  }
  updateSearchClearButtonVisibility()
  updateSearchNavButtons(false)
  setTimeout(() => searchInputEl?.focus(), 0)
}

/**
 * 検索バー使用状況をmainプロセスへ通知する（FR-011、フォーカス強制復帰の対象切替）。
 * TOCサイドバー検索は常時表示のため、入力欄・移動ボタンのフォーカス有無のみで判定する。
 */
function notifySearchFocusState(inUse: boolean): void {
  window.sidebarTocApi.searchFocusStateChanged(inUse, 'toc')
}

/** 検索欄フォーカス中のPageUp/PageDownで本文をスクロールする（FR-012） */
function handleSearchPageScroll(event: KeyboardEvent): void {
  if (event.key === 'PageUp') {
    event.preventDefault()
    window.sidebarTocApi.scrollContent('up')
  } else if (event.key === 'PageDown') {
    event.preventDefault()
    window.sidebarTocApi.scrollContent('down')
  }
}

/**
 * TOCサイドバー上部の検索欄（入力欄＋一致件数表示のみ、閉じるボタンなし）を初期化する
 * （FR-008a, FR-008b）。アプリ起動時に1回だけ呼び出す。
 */
function initSidebarSearch(): void {
  if (searchInitialized) {
    return
  }
  searchInitialized = true

  const container = getSearchContainerEl()
  container.innerHTML = ''

  const inputWrap = document.createElement('div')
  inputWrap.className = 'sidebar-toc-search__input-wrap'

  searchInputEl = document.createElement('input')
  searchInputEl.type = 'text'
  searchInputEl.className = 'sidebar-toc-search__input'
  searchInputEl.placeholder = '検索'
  searchInputEl.autocomplete = 'off'
  searchInputEl.setAttribute('aria-label', '目次内検索')

  searchClearBtnEl = document.createElement('button')
  searchClearBtnEl.type = 'button'
  searchClearBtnEl.className = 'sidebar-toc-search__clear'
  searchClearBtnEl.textContent = '×'
  searchClearBtnEl.setAttribute('aria-label', '検索文字列をクリア')
  searchClearBtnEl.hidden = true
  searchClearBtnEl.addEventListener('click', () => clearSearch())

  inputWrap.append(searchInputEl, searchClearBtnEl)

  searchCountEl = document.createElement('span')
  searchCountEl.className = 'sidebar-toc-search__count'
  searchCountEl.textContent = '0/0'

  searchPrevBtn = document.createElement('button')
  searchPrevBtn.type = 'button'
  searchPrevBtn.className = 'sidebar-toc-search__nav-btn'
  searchPrevBtn.textContent = '▲'
  searchPrevBtn.setAttribute('aria-label', '前の候補')
  searchPrevBtn.disabled = true
  searchPrevBtn.addEventListener('click', () => search(false, false))
  searchPrevBtn.addEventListener('keydown', handleSearchKeyNav)

  searchNextBtn = document.createElement('button')
  searchNextBtn.type = 'button'
  searchNextBtn.className = 'sidebar-toc-search__nav-btn'
  searchNextBtn.textContent = '▼'
  searchNextBtn.setAttribute('aria-label', '次の候補')
  searchNextBtn.disabled = true
  searchNextBtn.addEventListener('click', () => search(true, false))
  searchNextBtn.addEventListener('keydown', handleSearchKeyNav)

  container.append(inputWrap, searchCountEl, searchPrevBtn, searchNextBtn)

  searchInputEl.addEventListener('input', () => {
    search(true, true)
    updateSearchClearButtonVisibility()
  })

  searchInputEl.addEventListener('focus', () => notifySearchFocusState(true))
  searchInputEl.addEventListener('blur', () => notifySearchFocusState(false))

  searchInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search(!event.shiftKey, false)
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      handleSearchPageScroll(event)
    } else {
      handleSearchKeyNav(event)
    }
  })
  ;[searchPrevBtn, searchNextBtn].forEach((btn) => {
    btn.addEventListener('focus', () => notifySearchFocusState(true))
    btn.addEventListener('blur', () => notifySearchFocusState(false))
    btn.addEventListener('keydown', handleSearchPageScroll)
  })

  window.sidebarTocApi.onFindInPageResult((payload) => updateSearchCount(payload))
}

/** Ctrl+F押下時、TOCサイドバー表示中はこちらへフォーカス・選択を行う（FR-011） */
function focusSidebarSearch(): void {
  searchInputEl?.focus()
  searchInputEl?.select()
}

/**
 * F3/Shift+F3は、フォーカスが検索欄・移動ボタン以外（見出しリスト等）にあっても
 * ページ内検索の次/前候補へ移動できるようにする（実機フィードバック対応）。
 * 検索欄・移動ボタン自身の`handleSearchKeyNav`は`preventDefault()`済みのため、
 * `event.defaultPrevented`で二重発火を防ぐ。
 */
function initSearchShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      focusSidebarSearch()
    } else if (event.key === 'F3' && !event.defaultPrevented) {
      event.preventDefault()
      window.sidebarTocApi.requestFindNext(!event.shiftKey)
    }
  })
  // 本文View・タブバーViewでのCtrl+F押下も、mainプロセスでの判定（TOC表示中か）を経て
  // ここに転送される（`request-search-focus`ハンドラ、main/ipc/handlers.ts）
  window.sidebarTocApi.onFocusSidebarSearch(() => focusSidebarSearch())
}

/** ネイティブメニュー「表示」＞目次表示切替要求（005-native-menu-save-toggle FR-003） */
function initMenuTocVisibilityToggleListener(): void {
  window.sidebarTocApi.onMenuTocVisibilityToggleRequested(() => {
    setTocVisible(!getTocVisible())
  })
}

function initThemeListener(): void {
  window.sidebarTocApi.onThemeUpdated((theme) => {
    document.documentElement.classList.remove('theme-light', 'theme-dark')
    document.documentElement.classList.add(`theme-${theme}`)
  })
}

/**
 * 目次バー上でのCtrl+マウスホイールを検知し、本文Viewのズームをトリガーする
 * （036-iframe-html-view、001-core-viewer FR-006）。目次バー上でズーム操作できない
 * 不具合（033-webcontentsview-search-fixでUI/本文が4つのWebContentsViewに分離された際、
 * ズーム機能が本文Viewのみのものになっていた既存の回帰）への対応として追加した。
 * ズームされるのは本文のみとし、目次バー自体の見た目（文字サイズ・幅）は変化させない
 * （うつたかさんの実機フィードバック: 「目次バー上でホイールを検出してほしいが、
 * 目次自体は拡縮しなくてよい」）。そのため、mainプロセスへは`zoom-delta`を送るのみで、
 * 配信される`zoom-updated`はここでは購読しない（本文Viewのみが購読しCSS適用する）。
 */
function initZoom(): void {
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) {
        return
      }
      event.preventDefault()
      window.sidebarTocApi.notifyZoomDelta({ deltaY: event.deltaY })
    },
    { passive: false }
  )
}

/**
 * タブ切り替え時、mainプロセスが保持する検索文字列（真実の情報源、
 * ipc/handlers.ts `searchTextByTabId`）を受け取り入力欄へ復元する。
 * 復元した文字列があれば再検索し、件数・ハイライトも自然に復元される。
 * ただし実際に`findInPage`を呼ぶのは`payload.isActiveView`が`true`（TOC内検索が
 * 現在アクティブな検索UIである）場合のみ。フロート検索が使用中の間もこのイベントは届くが、
 * そちらでも無条件に再検索すると、非表示のTOC内検索側の応答が後から`activeSearchView`を
 * 奪い、検索結果がフロート検索側ではなくTOC側に届いてしまう不具合が実機で確認された
 * （`SearchClearedPayload.isActiveView`コメント参照）。
 */
function initSearchClearedListener(): void {
  window.sidebarTocApi.onSearchCleared((payload: SearchClearedPayload) => {
    currentTabId = payload.newTabId
    if (searchInputEl) {
      searchInputEl.value = payload.restoredText
    }
    updateSearchClearButtonVisibility()
    if (payload.restoredText && payload.isActiveView) {
      search(true, true)
    } else {
      if (searchCountEl) {
        searchCountEl.textContent = '0/0'
      }
      updateSearchNavButtons(false)
    }
  })
}

/**
 * フロート検索⇔TOCサイドバー内検索の切替時、mainプロセスが保持する現在タブの
 * 検索文字列を受け取り入力欄へ復元する（実機フィードバック対応: 同一タブ内では
 * 両検索UI間で検索文字列・件数を共有する）。
 */
function initRestoreSearchTextListener(): void {
  window.sidebarTocApi.onRestoreSearchText((payload: RestoreSearchTextPayload) => {
    if (searchInputEl) {
      searchInputEl.value = payload.text
    }
    updateSearchClearButtonVisibility()
    if (payload.text) {
      search(true, true)
    } else {
      if (searchCountEl) {
        searchCountEl.textContent = '0/0'
      }
      updateSearchNavButtons(false)
    }
  })
}

async function init(): Promise<void> {
  const settings = await window.sidebarTocApi.getAppSettings()
  document.documentElement.classList.add(`theme-${settings.theme}`)
  initTocVisible(settings.tocVisible)
  initTocWidth(settings.tocWidth)
  initSidebarSearch()
  initHeadingListUpdatedListener()
  initSearchShortcut()
  initSearchClearedListener()
  initRestoreSearchTextListener()
  initMenuTocVisibilityToggleListener()
  initThemeListener()
  initTocResizeHandle()
  initZoom()
}

void init()
