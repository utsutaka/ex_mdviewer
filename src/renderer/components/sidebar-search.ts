import type { FindInPageResultPayload } from '@shared/types'

/** TOC表示状態切替時に引き継ぐ検索状態（029-tab-toc-improvements FR-013a） */
export interface SidebarSearchState {
  text: string
}

let inputEl: HTMLInputElement | null = null
let countEl: HTMLSpanElement | null = null
let clearBtnEl: HTMLButtonElement | null = null
let prevBtn: HTMLButtonElement | null = null
let nextBtn: HTMLButtonElement | null = null
let initialized = false

function getContainerEl(): HTMLElement {
  const el = document.getElementById('sidebar-toc-search')
  if (!el) {
    throw new Error('sidebar-toc-search element not found')
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

/** 入力欄の値の有無に応じてインラインクリアボタンの表示を切り替える（FR-008b） */
function updateClearButtonVisibility(): void {
  if (!clearBtnEl) {
    return
  }
  clearBtnEl.hidden = !inputEl?.value
}

/** クリアボタン押下時、入力内容・一致件数表示をクリアする（FR-008b） */
function clearSearch(): void {
  if (!inputEl) {
    return
  }
  inputEl.value = ''
  window.api.stopFindInPage('clearSelection')
  if (countEl) {
    countEl.textContent = ''
  }
  updateClearButtonVisibility()
  updateNavButtons(false)
  setTimeout(() => inputEl?.focus(), 0)
}

/**
 * TOCサイドバー上部の検索欄（入力欄＋一致件数表示のみ、閉じるボタンなし）を初期化する
 * （FR-008a, FR-008b）。アプリ起動時に1回だけ呼び出す。
 */
export function initSidebarSearch(): void {
  if (initialized) {
    return
  }
  initialized = true

  const container = getContainerEl()
  container.innerHTML = ''

  const inputWrap = document.createElement('div')
  inputWrap.className = 'sidebar-toc-search__input-wrap'

  inputEl = document.createElement('input')
  inputEl.type = 'text'
  inputEl.className = 'sidebar-toc-search__input'
  inputEl.placeholder = '検索'
  inputEl.autocomplete = 'off'
  inputEl.setAttribute('aria-label', '目次内検索')

  clearBtnEl = document.createElement('button')
  clearBtnEl.type = 'button'
  clearBtnEl.className = 'sidebar-toc-search__clear'
  clearBtnEl.textContent = '×'
  clearBtnEl.setAttribute('aria-label', '検索文字列をクリア')
  clearBtnEl.hidden = true
  clearBtnEl.addEventListener('click', () => clearSearch())

  inputWrap.append(inputEl, clearBtnEl)

  countEl = document.createElement('span')
  countEl.className = 'sidebar-toc-search__count'

  prevBtn = document.createElement('button')
  prevBtn.type = 'button'
  prevBtn.className = 'sidebar-toc-search__nav-btn'
  prevBtn.textContent = '▲'
  prevBtn.setAttribute('aria-label', '前の候補')
  prevBtn.disabled = true
  prevBtn.addEventListener('click', () => search(false, true))
  prevBtn.addEventListener('keydown', handleArrowKeyNav)

  nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.className = 'sidebar-toc-search__nav-btn'
  nextBtn.textContent = '▼'
  nextBtn.setAttribute('aria-label', '次の候補')
  nextBtn.disabled = true
  nextBtn.addEventListener('click', () => search(true, true))
  nextBtn.addEventListener('keydown', handleArrowKeyNav)

  container.append(inputWrap, countEl, prevBtn, nextBtn)

  inputEl.addEventListener('input', () => {
    search(true, false)
    updateClearButtonVisibility()
  })

  /** Enter/Shift+Enter/↑↓によるキーボードのみでの次候補・前候補移動（既存search-bar.tsのFR-030相当を踏襲） */
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search(!event.shiftKey, true)
    } else {
      handleArrowKeyNav(event)
    }
  })

  window.api.onFindInPageResult((payload) => updateCount(payload))
}

/** Ctrl+F押下時、TOCサイドバー表示中はこちらへフォーカス・選択を行う（FR-011） */
export function focusSidebarSearch(): void {
  inputEl?.focus()
  inputEl?.select()
}

/** TOC表示状態切替時の状態同期用、現在の入力文字列を取得する（FR-013a） */
export function getSearchState(): SidebarSearchState {
  return { text: inputEl?.value ?? '' }
}

/**
 * TOC表示状態切替時の状態同期用、入力文字列を適用し検索を再実行する（FR-013a）。
 * 空文字列の場合は検索を実行せず、表示状態のみ初期化する。
 */
export function applySearchState(state: SidebarSearchState): void {
  if (!inputEl) {
    return
  }
  inputEl.value = state.text
  updateClearButtonVisibility()
  if (state.text) {
    window.api.findInPage(state.text, true, false)
  }
}
