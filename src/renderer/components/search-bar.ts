import type { FindInPageResultPayload } from '@shared/types'

let barEl: HTMLElement | null = null
let inputEl: HTMLInputElement | null = null
let countEl: HTMLSpanElement | null = null
let initialized = false

function getBarEl(): HTMLElement {
  const el = document.getElementById('search-bar')
  if (!el) {
    throw new Error('search-bar element not found')
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

/** ページ内検索UI（findInPage連携）を初期化する（FR-005） */
function ensureInitialized(): void {
  if (initialized) {
    return
  }
  initialized = true

  const bar = getBarEl()
  bar.innerHTML = ''

  inputEl = document.createElement('input')
  inputEl.type = 'text'
  inputEl.placeholder = '検索'
  inputEl.setAttribute('aria-label', 'ページ内検索')

  countEl = document.createElement('span')
  countEl.className = 'search-bar__count'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = '閉じる'
  closeButton.addEventListener('click', () => closeSearchBar())

  bar.append(inputEl, countEl, closeButton)

  inputEl.addEventListener('input', () => search(true, false))

  /** Enter/Shift+Enterによるキーボードのみでの次候補・前候補移動（FR-030） */
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search(!event.shiftKey, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchBar()
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
}

export function isSearchBarOpen(): boolean {
  return barEl ? !barEl.hidden : !getBarEl().hidden
}
