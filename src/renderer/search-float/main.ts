import type { FindInPageResultPayload, RestoreSearchTextPayload, SearchClearedPayload } from '@shared/types'

let inputEl: HTMLInputElement | null = null
let countEl: HTMLSpanElement | null = null
let clearBtnEl: HTMLButtonElement | null = null
let prevBtn: HTMLButtonElement | null = null
let nextBtn: HTMLButtonElement | null = null
let initialized = false
/** `search-cleared`で通知された、現在アクティブなタブID（タブ単位の検索文字列通知に使用） */
let currentTabId = ''

function getBarEl(): HTMLElement {
  const el = document.getElementById('search-bar')
  if (!el) {
    throw new Error('search-bar element not found')
  }
  return el
}

/** 移動ボタンの活性/非活性を一致件数に応じて切り替える（FR-007） */
function updateNavButtons(hasMatches: boolean): void {
  if (prevBtn) {
    prevBtn.disabled = !hasMatches
  }
  if (nextBtn) {
    nextBtn.disabled = !hasMatches
  }
}

function updateCount(payload: FindInPageResultPayload): void {
  if (!countEl) {
    return
  }
  countEl.textContent = payload.matches === 0 ? '0/0' : `${payload.activeMatchOrdinal}/${payload.matches}`
  updateNavButtons(payload.matches > 0)
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

/** 検索欄フォーカス中のPageUp/PageDownで本文をスクロールする（FR-012） */
function handlePageScroll(event: KeyboardEvent): void {
  if (event.key === 'PageUp') {
    event.preventDefault()
    window.searchFloatApi.scrollContent('up')
  } else if (event.key === 'PageDown') {
    event.preventDefault()
    window.searchFloatApi.scrollContent('down')
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
  const text = inputEl?.value ?? ''
  if (currentTabId) {
    window.searchFloatApi.searchTextChanged(currentTabId, text)
  }
  if (!text) {
    window.searchFloatApi.stopFindInPage('clearSelection')
    if (countEl) {
      countEl.textContent = '0/0'
    }
    updateNavButtons(false)
    // stopFindInPageによる本文側へのフォーカス移動が非同期に発生する（Electron #22880）ため、
    // 同一イベントループ内でfocus()しても上書きされる。次のイベントループまで遅延させて戻す
    setTimeout(() => inputEl?.focus(), 0)
    return
  }
  window.searchFloatApi.findInPage(text, forward, findNext)
}

/** 入力欄の値の有無に応じてインラインクリアボタンの表示を切り替える */
function updateClearButtonVisibility(): void {
  if (!clearBtnEl) {
    return
  }
  clearBtnEl.hidden = !inputEl?.value
}

/** クリアボタン押下時、入力内容・一致件数表示をクリアする */
function clearSearchText(): void {
  if (!inputEl) {
    return
  }
  inputEl.value = ''
  if (currentTabId) {
    window.searchFloatApi.searchTextChanged(currentTabId, '')
  }
  window.searchFloatApi.stopFindInPage('clearSelection')
  if (countEl) {
    countEl.textContent = '0/0'
  }
  updateNavButtons(false)
  updateClearButtonVisibility()
  setTimeout(() => inputEl?.focus(), 0)
}

/** 検索バー使用状況をmainプロセスへ通知する（FR-011）。フロート検索は開閉状態も判定に含む */
function notifySearchFocusState(inUse: boolean): void {
  window.searchFloatApi.searchFocusStateChanged(inUse, 'float')
}

/** ページ内検索UI（findInPage連携）を初期化する（FR-005） */
function ensureInitialized(): void {
  if (initialized) {
    return
  }
  initialized = true

  const bar = getBarEl()
  bar.innerHTML = ''

  const inputWrap = document.createElement('div')
  inputWrap.className = 'search-bar__input-wrap'

  inputEl = document.createElement('input')
  inputEl.type = 'text'
  inputEl.placeholder = '検索'
  inputEl.autocomplete = 'off'
  inputEl.setAttribute('aria-label', 'ページ内検索')

  clearBtnEl = document.createElement('button')
  clearBtnEl.type = 'button'
  clearBtnEl.className = 'search-bar__clear'
  clearBtnEl.textContent = '×'
  clearBtnEl.setAttribute('aria-label', '検索文字列をクリア')
  clearBtnEl.hidden = true
  clearBtnEl.addEventListener('click', () => clearSearchText())

  inputWrap.append(inputEl, clearBtnEl)

  countEl = document.createElement('span')
  countEl.className = 'search-bar__count'
  countEl.textContent = '0/0'

  const navWrap = document.createElement('div')
  navWrap.className = 'search-bar__nav'

  prevBtn = document.createElement('button')
  prevBtn.type = 'button'
  prevBtn.textContent = '▲'
  prevBtn.setAttribute('aria-label', '前の候補')
  prevBtn.disabled = true
  prevBtn.addEventListener('click', () => search(false, false))
  prevBtn.addEventListener('keydown', handleSearchKeyNav)

  const navDivider = document.createElement('div')
  navDivider.className = 'search-bar__nav-divider'

  nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.textContent = '▼'
  nextBtn.setAttribute('aria-label', '次の候補')
  nextBtn.disabled = true
  nextBtn.addEventListener('click', () => search(true, false))
  nextBtn.addEventListener('keydown', handleSearchKeyNav)

  navWrap.append(prevBtn, navDivider, nextBtn)

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = '閉じる'
  closeButton.addEventListener('click', () => window.searchFloatApi.closeSearchFloat())

  bar.append(inputWrap, countEl, navWrap, closeButton)

  inputEl.addEventListener('input', () => {
    search(true, true)
    updateClearButtonVisibility()
  })

  inputEl.addEventListener('focus', () => notifySearchFocusState(true))
  inputEl.addEventListener('blur', () => notifySearchFocusState(false))
  ;[prevBtn, nextBtn].forEach((btn) => {
    btn.addEventListener('focus', () => notifySearchFocusState(true))
    btn.addEventListener('blur', () => notifySearchFocusState(false))
  })

  /** Enter/Shift+Enter/F3/Shift+F3/PageUp/PageDownによるキーボードのみでの候補移動・本文スクロール（FR-030, FR-012） */
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search(!event.shiftKey, false)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      window.searchFloatApi.closeSearchFloat()
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      handlePageScroll(event)
    } else {
      handleSearchKeyNav(event)
    }
  })

  window.searchFloatApi.onFindInPageResult((payload) => updateCount(payload))
}

function initThemeListener(): void {
  window.searchFloatApi.onThemeUpdated((theme) => {
    document.documentElement.classList.remove('theme-light', 'theme-dark')
    document.documentElement.classList.add(`theme-${theme}`)
  })
}

/**
 * タブ切り替え時、mainプロセスが保持する検索文字列（真実の情報源、
 * ipc/handlers.ts `searchTextByTabId`）を受け取り入力欄へ復元する。
 * 復元した文字列があれば再検索し、件数・ハイライトも自然に復元される。
 * ただし実際に`findInPage`を呼ぶのは`payload.isActiveView`が`true`（フロート検索が
 * 現在アクティブな検索UIである）場合のみ。TOC内検索が使用中の間もこのイベントは届くが、
 * そちらでも無条件に再検索すると、非表示のフロート検索側の応答が後から`activeSearchView`を
 * 奪い、検索結果がTOC側ではなくフロート検索側に届いてしまう不具合が実機で確認された
 * （`SearchClearedPayload.isActiveView`コメント参照）。
 */
function initSearchClearedListener(): void {
  window.searchFloatApi.onSearchCleared((payload: SearchClearedPayload) => {
    currentTabId = payload.newTabId
    if (inputEl) {
      inputEl.value = payload.restoredText
    }
    updateClearButtonVisibility()
    if (payload.restoredText && payload.isActiveView) {
      search(true, true)
    } else {
      if (countEl) {
        countEl.textContent = '0/0'
      }
      updateNavButtons(false)
    }
  })
}

/**
 * TOCサイドバー内検索⇔フロート検索の切替時、mainプロセスが保持する現在タブの
 * 検索文字列を受け取り入力欄へ復元する（実機フィードバック対応: 同一タブ内では
 * 両検索UI間で検索文字列・件数を共有する）。
 */
function initRestoreSearchTextListener(): void {
  window.searchFloatApi.onRestoreSearchText((payload: RestoreSearchTextPayload) => {
    if (inputEl) {
      inputEl.value = payload.text
    }
    updateClearButtonVisibility()
    if (payload.text) {
      search(true, true)
    } else {
      if (countEl) {
        countEl.textContent = '0/0'
      }
      updateNavButtons(false)
    }
  })
}

/**
 * Viewは`setVisible`方式で常時存在し、開くたびに`main.ts`が再実行されるわけではないため
 * （research.md Decision 1a、実機フィードバックにより体感速度改善のため事前生成方式へ変更）、
 * 表示されるたびにmainプロセスから送られる`search-float-shown`を受けてフォーカス処理を行う。
 */
function initSearchFloatShownListener(): void {
  window.searchFloatApi.onSearchFloatShown(() => {
    notifySearchFocusState(true)
    inputEl?.focus()
    inputEl?.select()
  })
}

/**
 * F3/Shift+F3は、フォーカスが検索欄・移動ボタン以外（閉じるボタン等）にあっても
 * ページ内検索の次/前候補へ移動できるようにする（実機フィードバック対応）。
 * 検索欄・移動ボタン自身の`handleSearchKeyNav`は`preventDefault()`済みのため、
 * `event.defaultPrevented`で二重発火を防ぐ。
 */
function initGlobalFindNextShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F3' && !event.defaultPrevented) {
      event.preventDefault()
      window.searchFloatApi.requestFindNext(!event.shiftKey)
    }
  })
}

async function init(): Promise<void> {
  const settings = await window.searchFloatApi.getAppSettings()
  document.documentElement.classList.add(`theme-${settings.theme}`)
  initThemeListener()
  initSearchClearedListener()
  initRestoreSearchTextListener()
  initSearchFloatShownListener()
  initGlobalFindNextShortcut()
  ensureInitialized()
}

void init()
