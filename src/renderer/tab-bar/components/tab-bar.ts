import type { DisplayMode, FileKind } from '@shared/types'
import { isRawToggleSupported } from '@shared/file-kind'

export interface TabBarCallbacks {
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  /** raw表示切替ボタンのクリック（019-raw-source-toggle FR-001） */
  onToggleDisplayMode: (tabId: string) => void
}

interface TabElementState {
  tabId: string
  el: HTMLDivElement
  /** markdown/html以外のfileKindではボタン自体を生成しないためnull（FR-011） */
  rawToggleEl: HTMLButtonElement | null
}

const tabElements = new Map<string, TabElementState>()
let callbacks: TabBarCallbacks | null = null

/** タブ1件あたりの固定幅（px）。既存の縮小方式における上限値を踏襲する（029-tab-toc-improvements Assumptions） */
const TAB_WIDTH = 220

function getTabBarEl(): HTMLElement {
  const el = document.getElementById('tab-bar')
  if (!el) {
    throw new Error('tab-bar element not found')
  }
  return el
}

function getScrollButtons(): { left: HTMLButtonElement; right: HTMLButtonElement } {
  const wrapper = getTabBarEl().parentElement
  const left = wrapper?.querySelector<HTMLButtonElement>('.tab-bar-scroll-btn--left')
  const right = wrapper?.querySelector<HTMLButtonElement>('.tab-bar-scroll-btn--right')
  if (!left || !right) {
    throw new Error('tab-bar scroll buttons not found')
  }
  return { left, right }
}

/**
 * タブバーのスクロール位置に応じて左右スクロールボタンの表示可否を更新する（FR-004, FR-007）。
 * `addTab`/`removeTab`（タブ数の増減）、`scroll`イベント、`ResizeObserver`（ウィンドウリサイズ）の
 * いずれの契機でも呼び出す。`ResizeObserver`は`#tab-bar`自身のcontent-boxサイズ変化のみを監視し、
 * 子要素増加によるscrollWidthのみの変化は検知できないため、`addTab`からの明示呼び出しが必須
 * （research.md Decision 1、`/speckit-analyze` finding U1対応）。
 */
function updateScrollButtonsVisibility(): void {
  const bar = getTabBarEl()
  const { left, right } = getScrollButtons()
  const maxScrollLeft = bar.scrollWidth - bar.clientWidth
  left.hidden = bar.scrollLeft <= 0
  right.hidden = bar.scrollLeft >= maxScrollLeft - 1
}

/**
 * 対象タブが現在のタブバー表示範囲外にある場合、タブバーをスクロールして
 * 表示範囲の中央付近に収める（FR-006）。
 */
function scrollTabIntoViewIfNeeded(tabId: string): void {
  const state = tabElements.get(tabId)
  if (!state) {
    return
  }
  const bar = getTabBarEl()
  const el = state.el
  const isVisible = el.offsetLeft >= bar.scrollLeft && el.offsetLeft + el.offsetWidth <= bar.scrollLeft + bar.clientWidth
  if (isVisible) {
    return
  }
  const elCenter = el.offsetLeft + el.offsetWidth / 2
  const targetScrollLeft = elCenter - bar.clientWidth / 2
  bar.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
}

/** 左右スクロールボタンのクリック・自動再評価（scroll/resize）を配線する（FR-001〜FR-005） */
function initTabBarScroll(): void {
  const bar = getTabBarEl()
  const { left, right } = getScrollButtons()

  left.addEventListener('click', () => {
    bar.scrollBy({ left: -TAB_WIDTH, behavior: 'smooth' })
  })
  right.addEventListener('click', () => {
    bar.scrollBy({ left: TAB_WIDTH, behavior: 'smooth' })
  })

  bar.addEventListener('scroll', () => updateScrollButtonsVisibility())

  const resizeObserver = new ResizeObserver(() => updateScrollButtonsVisibility())
  resizeObserver.observe(bar)

  updateScrollButtonsVisibility()
}

export function initTabBar(cb: TabBarCallbacks): void {
  callbacks = cb
  initTabBarScroll()
}

function orderedTabIds(): string[] {
  return Array.from(tabElements.keys())
}

/** 矢印キー・Enterによるキーボードのみでのタブ切替、Deleteによるクローズ（FR-031） */
function handleTabKeydown(event: KeyboardEvent, tabId: string): void {
  const ids = orderedTabIds()
  const index = ids.indexOf(tabId)

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    const nextId = ids[Math.min(index + 1, ids.length - 1)]
    tabElements.get(nextId)?.el.focus()
    callbacks?.onActivate(nextId)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    const prevId = ids[Math.max(index - 1, 0)]
    tabElements.get(prevId)?.el.focus()
    callbacks?.onActivate(prevId)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    callbacks?.onActivate(tabId)
  } else if (event.key === 'Delete' || (event.key.toLowerCase() === 'w' && event.ctrlKey)) {
    event.preventDefault()
    callbacks?.onClose(tabId)
  }
}

/**
 * タブを追加する。titleは拡張子込みのファイル名をそのまま表示し（029-tab-toc-improvements FR-014）、
 * 他タブと重複していても区別処理は行わない。ホバー時はネイティブtitle属性で
 * フルパスをツールチップ表示する（FR-039, FR-040, 029-tab-toc-improvements FR-015）。
 * fileKindがmarkdown/htmlの場合のみ、ラベルと閉じるボタンの間にraw表示切替ボタンを追加する
 * （019-raw-source-toggle FR-001, FR-011）。`<button>`要素として実装することで、
 * Tabキーによるフォーカス移動・Enter/Spaceキーでの発火はネイティブ挙動でFR-016を満たす。
 */
export function addTab(tabId: string, filePath: string, title: string, fileKind: FileKind): void {
  const bar = getTabBarEl()

  const el = document.createElement('div')
  el.className = 'tab-bar__tab is-loading'
  el.dataset.tabId = tabId
  el.title = filePath
  el.tabIndex = 0
  el.setAttribute('role', 'tab')

  const spinnerEl = document.createElement('span')
  spinnerEl.className = 'tab-bar__spinner'
  spinnerEl.setAttribute('aria-hidden', 'true')

  const labelEl = document.createElement('span')
  labelEl.className = 'tab-bar__label'
  labelEl.textContent = title

  let rawToggleEl: HTMLButtonElement | null = null
  if (isRawToggleSupported(fileKind)) {
    rawToggleEl = document.createElement('button')
    rawToggleEl.type = 'button'
    rawToggleEl.className = 'tab-bar__raw-toggle'
    rawToggleEl.textContent = '</>'
    rawToggleEl.title = '生データ表示に切替'
    rawToggleEl.addEventListener('click', (event) => {
      event.stopPropagation()
      callbacks?.onToggleDisplayMode(tabId)
    })
    // 親要素（tab-bar__tab）のhandleTabKeydownがEnter/Spaceでevent.preventDefault()するため、
    // バブリングさせるとbuttonネイティブのEnter/Space→click変換が阻害される。ここで止めて
    // ネイティブ挙動のみに委ねる（019-raw-source-toggle FR-016, research.md Decision 5）。
    rawToggleEl.addEventListener('keydown', (event) => {
      event.stopPropagation()
    })
  }

  const closeEl = document.createElement('button')
  closeEl.type = 'button'
  closeEl.className = 'tab-bar__close'
  closeEl.textContent = '×'
  closeEl.setAttribute('aria-label', 'タブを閉じる')
  closeEl.addEventListener('click', (event) => {
    event.stopPropagation()
    callbacks?.onClose(tabId)
  })

  el.append(spinnerEl, labelEl, ...(rawToggleEl ? [rawToggleEl] : []), closeEl)
  el.addEventListener('click', () => callbacks?.onActivate(tabId))
  el.addEventListener('keydown', (event) => handleTabKeydown(event, tabId))

  bar.appendChild(el)
  tabElements.set(tabId, { tabId, el, rawToggleEl })
  updateScrollButtonsVisibility()
}

/**
 * raw表示切替ボタンの見た目（アイコン・ツールチップ・ハイライト状態）を更新する
 * （019-raw-source-toggle FR-004）。対象外fileKindのタブ（rawToggleEl===null）では何もしない。
 */
export function setTabDisplayModeUi(tabId: string, mode: DisplayMode): void {
  const rawToggleEl = tabElements.get(tabId)?.rawToggleEl
  if (!rawToggleEl) {
    return
  }
  const isRaw = mode === 'raw'
  rawToggleEl.classList.toggle('is-raw-mode', isRaw)
  rawToggleEl.textContent = isRaw ? '●' : '</>'
  rawToggleEl.title = isRaw ? 'レンダリング表示に切替' : '生データ表示に切替'
}

/** file-opened受信時、タブ毎のローディング表示を解除する（FR-034） */
export function markTabLoaded(tabId: string): void {
  tabElements.get(tabId)?.el.classList.remove('is-loading')
}

export function removeTab(tabId: string): void {
  const state = tabElements.get(tabId)
  if (!state) {
    return
  }
  state.el.remove()
  tabElements.delete(tabId)
  updateScrollButtonsVisibility()
}

export function setActiveTabUi(tabId: string): void {
  for (const [id, state] of tabElements) {
    state.el.classList.toggle('is-active', id === tabId)
  }
  scrollTabIntoViewIfNeeded(tabId)
}

export function focusTabUi(tabId: string): void {
  tabElements.get(tabId)?.el.focus()
}

export function hasTab(tabId: string): boolean {
  return tabElements.has(tabId)
}

export function tabCount(): number {
  return tabElements.size
}

export function firstTabId(): string | undefined {
  return orderedTabIds()[0]
}
