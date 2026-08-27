import type { FindInPageResultPayload } from '@shared/types'

let barEl: HTMLElement | null = null
let inputEl: HTMLInputElement | null = null
let countEl: HTMLSpanElement | null = null
let clearBtnEl: HTMLButtonElement | null = null
let prevBtn: HTMLButtonElement | null = null
let nextBtn: HTMLButtonElement | null = null
let initialized = false

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

/** ↑↓キーによる次候補・前候補移動（検索欄・移動ボタンの両方に登録する） */
function handleArrowKeyNav(event: KeyboardEvent): void {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    search(false, true)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    search(true, true)
  }
}

function search(forward: boolean, findNext: boolean): void {
  const text = inputEl?.value ?? ''
  if (!text) {
    window.api.stopFindInPage('clearSelection')
    if (countEl) {
      countEl.textContent = ''
    }
    updateNavButtons(false)
    // stopFindInPageによる本文側へのフォーカス移動が非同期に発生する（Electron #22880）ため、
    // 同一イベントループ内でfocus()しても上書きされる。次のイベントループまで遅延させて戻す
    setTimeout(() => inputEl?.focus(), 0)
    return
  }
  window.api.findInPage(text, forward, findNext)
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
  window.api.stopFindInPage('clearSelection')
  if (countEl) {
    countEl.textContent = ''
  }
  updateNavButtons(false)
  updateClearButtonVisibility()
  setTimeout(() => inputEl?.focus(), 0)
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

  const navWrap = document.createElement('div')
  navWrap.className = 'search-bar__nav'

  prevBtn = document.createElement('button')
  prevBtn.type = 'button'
  prevBtn.textContent = '▲'
  prevBtn.setAttribute('aria-label', '前の候補')
  prevBtn.disabled = true
  prevBtn.addEventListener('click', () => search(false, true))
  prevBtn.addEventListener('keydown', handleArrowKeyNav)

  const navDivider = document.createElement('div')
  navDivider.className = 'search-bar__nav-divider'

  nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.textContent = '▼'
  nextBtn.setAttribute('aria-label', '次の候補')
  nextBtn.disabled = true
  nextBtn.addEventListener('click', () => search(true, true))
  nextBtn.addEventListener('keydown', handleArrowKeyNav)

  navWrap.append(prevBtn, navDivider, nextBtn)

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = '閉じる'
  closeButton.addEventListener('click', () => closeSearchBar())

  bar.append(inputWrap, countEl, navWrap, closeButton)

  inputEl.addEventListener('input', () => {
    search(true, false)
    updateClearButtonVisibility()
  })

  /** Enter/Shift+Enter/↑↓によるキーボードのみでの次候補・前候補移動（FR-030） */
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search(!event.shiftKey, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchBar()
    } else {
      handleArrowKeyNav(event)
    }
  })

  window.api.onFindInPageResult((payload) => updateCount(payload))
}

export function openSearchBar(): void {
  ensureInitialized()
  const bar = getBarEl()
  bar.hidden = false
  inputEl?.focus()
  inputEl?.select()
}

export function closeSearchBar(): void {
  const bar = getBarEl()
  bar.hidden = true
  window.api.stopFindInPage('clearSelection')
  if (countEl) {
    countEl.textContent = ''
  }
  updateNavButtons(false)
}

export function isSearchBarOpen(): boolean {
  return barEl ? !barEl.hidden : !getBarEl().hidden
}

/** TOC表示状態切替時の状態同期用、現在の入力文字列を取得する（029-tab-toc-improvements FR-013a） */
export function getSearchState(): { text: string } {
  return { text: inputEl?.value ?? '' }
}

/**
 * TOC表示状態切替時の状態同期用、入力文字列を適用し検索を再実行する
 * （029-tab-toc-improvements FR-013a）。未初期化の場合は`ensureInitialized`を先に行う。
 */
export function applySearchState(state: { text: string }): void {
  ensureInitialized()
  if (!inputEl) {
    return
  }
  inputEl.value = state.text
  updateClearButtonVisibility()
  if (state.text) {
    search(true, false)
  }
}
