import type { FindInPageResultPayload } from '@shared/types'

/** TOC表示状態切替時に引き継ぐ検索状態（029-tab-toc-improvements FR-013a） */
export interface SidebarSearchState {
  text: string
}

let inputEl: HTMLInputElement | null = null
let countEl: HTMLSpanElement | null = null
let clearBtnEl: HTMLButtonElement | null = null
let initialized = false

function getContainerEl(): HTMLElement {
  const el = document.getElementById('sidebar-toc-search')
  if (!el) {
    throw new Error('sidebar-toc-search element not found')
  }
  return el
}

function updateCount(payload: FindInPageResultPayload): void {
  if (!countEl) {
    return
  }
  countEl.textContent = payload.matches === 0 ? '0/0' : `${payload.activeMatchOrdinal}/${payload.matches}`
}

function search(forward: boolean, findNext: boolean): void {
  const text = inputEl?.value ?? ''
  if (!text) {
    window.api.stopFindInPage('clearSelection')
    if (countEl) {
      countEl.textContent = ''
    }
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
  inputEl.focus()
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

  container.append(inputWrap, countEl)

  inputEl.addEventListener('input', () => {
    search(true, false)
    updateClearButtonVisibility()
  })

  /** Enter/Shift+Enterによるキーボードのみでの次候補・前候補移動（既存search-bar.tsのFR-030相当を踏襲） */
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search(!event.shiftKey, true)
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
