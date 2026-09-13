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
  // 塊への入場時（Tab/Shift+Tabで他の塊からtab塊へ移動してきた場合）、現在アクティブな
  // タブへフォーカスする（039-tab-reorder-keyboard-nav、research.md Decision 5）。
  window.tabBarApi.onFocusCycleEntered(() => {
    for (const state of tabElements.values()) {
      if (state.el.classList.contains('is-active')) {
        state.el.focus()
        return
      }
    }
  })
}

/** ドラッグ開始とみなす移動量の閾値（px）。単純なクリックとドラッグ操作を区別する */
const DRAG_THRESHOLD_PX = 4

let draggingTabId: string | null = null
let dragPointerId: number | null = null
let dragStartX = 0
let dragLastClientX = 0
let hasDraggedPastThreshold = false
/** ドラッグ確定直後に発火するclickイベントでタブがアクティブ化されるのを防ぐ（FR-001a） */
let suppressClickForTabId: string | null = null

/**
 * 現在のポインタX座標を基準に、ドロップ予定位置（挿入先の参照要素）を求める
 * （039-tab-reorder-keyboard-nav FR-001〜FR-003, FR-005）。他のタブの中心を基準に決める。
 * `null`は末尾への挿入を意味する。
 */
function findDropReference(bar: HTMLElement, draggedEl: HTMLElement, clientX: number): HTMLElement | null {
  const others = Array.from(bar.querySelectorAll<HTMLElement>('.tab-bar__tab')).filter((el) => el !== draggedEl)
  for (const candidate of others) {
    const rect = candidate.getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2
    if (clientX < midpoint) {
      return candidate
    }
  }
  return null
}

/**
 * ドロップ予定位置の参照要素に、視覚的な挿入位置インジケーターを付与する（FR-002）。
 * ドラッグ中は実際のDOM移動を行わない（`insertBefore`によるDOM移動はPointer Captureを
 * 喪失させ、以降の`pointermove`/`pointerup`が発火しなくなる実機不具合が確認されたため、
 * research.md「残存する技術的リスク」記載の懸念が実際に顕在化した。DOM移動はドロップ確定時
 * 〈`pointerup`〉の1回のみに限定し、ドラッグ中は`transform`によるライブ追従とクラス付与
 * のみで視覚的に示す）。
 */
function updateDropIndicator(reference: HTMLElement | null): void {
  for (const state of tabElements.values()) {
    state.el.classList.remove('is-drop-target-before')
  }
  reference?.classList.add('is-drop-target-before')
}

function clearDropIndicator(): void {
  for (const state of tabElements.values()) {
    state.el.classList.remove('is-drop-target-before')
  }
}

function resetDragState(): void {
  draggingTabId = null
  dragPointerId = null
  hasDraggedPastThreshold = false
  dragLastClientX = 0
}

/**
 * タブ要素へのPointer Eventsによるドラッグ並び替え（039-tab-reorder-keyboard-nav
 * FR-001〜FR-005, FR-001a）。既存の「タブバー領域への外部ファイルドラッグ&ドロップで
 * 開く」機能（`tab-bar/main.ts`のネイティブHTML5 D&D）とは`DataTransfer`を介さず、
 * 実装上完全に独立している（research.md Decision 3）。
 */
function initTabDrag(el: HTMLDivElement, tabId: string): void {
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return
    }
    const targetEl = event.target as HTMLElement
    if (targetEl.closest('.tab-bar__raw-toggle, .tab-bar__close')) {
      // RAW切替・閉じるボタンでの操作は既存のクリック動作に委ねる（ドラッグを開始しない）
      return
    }
    draggingTabId = tabId
    dragPointerId = event.pointerId
    dragStartX = event.clientX
    dragLastClientX = event.clientX
    hasDraggedPastThreshold = false
    el.setPointerCapture(event.pointerId)
  })

  el.addEventListener('pointermove', (event) => {
    if (draggingTabId !== tabId || dragPointerId !== event.pointerId) {
      return
    }
    if (!hasDraggedPastThreshold) {
      if (Math.abs(event.clientX - dragStartX) < DRAG_THRESHOLD_PX) {
        return
      }
      hasDraggedPastThreshold = true
      el.classList.add('is-dragging')
    }
    dragLastClientX = event.clientX
    // DOM移動はまだ行わず、transformによる追従とドロップ位置インジケーターのみ更新する
    el.style.transform = `translateX(${event.clientX - dragStartX}px)`
    updateDropIndicator(findDropReference(getTabBarEl(), el, event.clientX))
  })

  el.addEventListener('pointerup', (event) => {
    if (draggingTabId !== tabId || dragPointerId !== event.pointerId) {
      return
    }
    el.releasePointerCapture(event.pointerId)
    el.classList.remove('is-dragging')
    el.style.transform = ''
    clearDropIndicator()

    if (hasDraggedPastThreshold) {
      const bar = getTabBarEl()
      const barRect = bar.getBoundingClientRect()
      const isOutsideBar =
        event.clientX < barRect.left ||
        event.clientX > barRect.right ||
        event.clientY < barRect.top ||
        event.clientY > barRect.bottom
      if (isOutsideBar) {
        // タブバー外へのドロップは無効とし、元の位置のまま変更しない（FR-005）
      } else {
        // ドロップ確定時にのみDOM上の位置を1回だけ確定させる（research.md参照）
        const reference = findDropReference(bar, el, dragLastClientX)
        if (reference) {
          bar.insertBefore(el, reference)
        } else {
          bar.appendChild(el)
        }
      }
      suppressClickForTabId = tabId
      updateScrollButtonsVisibility()
    }

    resetDragState()
  })

  el.addEventListener('pointercancel', () => {
    if (draggingTabId !== tabId) {
      return
    }
    el.classList.remove('is-dragging')
    el.style.transform = ''
    clearDropIndicator()
    // ドラッグ取消時はDOM移動自体を行っていないため、位置を戻す処理は不要
    resetDragState()
  })
}

/**
 * DOM子要素の配列からタブID順序配列を返す純粋関数（039-tab-reorder-keyboard-nav、
 * research.md Decision 4）。`tabId`が`undefined`の要素（タブ以外の要素が紛れ込んだ場合）は除外する。
 */
export function tabIdsFromDomOrder(children: readonly { tabId: string | undefined }[]): string[] {
  return children
    .map((child) => child.tabId)
    .filter((tabId): tabId is string => tabId !== undefined)
}

/**
 * タブの並び順は、`tabElements`（Mapの挿入順）ではなく`#tab-bar`のDOM上の実際の子要素順を
 * 正とする（039-tab-reorder-keyboard-nav、research.md Decision 4）。ドラッグ＆ドロップによる
 * 並び替えはDOM上の要素移動のみで完結し、この関数を経由する既存の全ロジック（矢印キー切替・
 * 自動スクロール・横スクロールボタン表示判定）が変更なしに新しい並び順へ追随する。
 */
function orderedTabIds(): string[] {
  const bar = getTabBarEl()
  const children = Array.from(bar.children).map((el) => ({ tabId: (el as HTMLElement).dataset.tabId }))
  return tabIdsFromDomOrder(children)
}

/**
 * tab塊内のキー操作（039-tab-reorder-keyboard-nav FR-012〜FR-018）。
 * 左右矢印キーでタブ切替（FR-012、自動スクロールは`setActiveTabUi`経由の
 * `scrollTabIntoViewIfNeeded`で担保）、EnterキーのみでタブをアクティブID化（FR-015）、
 * スペースキーでRAW表示切替（FR-014）、Delete/Ctrl+Wキーでクローズ（FR-019、既存維持）、
 * Tab/Shift+Tabキーで塊外（次/前の塊）へ直接離脱する（FR-017, FR-018）。
 */
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
  } else if (event.key === 'Enter') {
    event.preventDefault()
    callbacks?.onActivate(tabId)
  } else if (event.key === ' ') {
    event.preventDefault()
    callbacks?.onToggleDisplayMode(tabId)
  } else if (event.key === 'Delete' || (event.key.toLowerCase() === 'w' && event.ctrlKey)) {
    event.preventDefault()
    callbacks?.onClose(tabId)
  } else if (event.key === 'Tab') {
    event.preventDefault()
    window.tabBarApi.requestFocusCycle(event.shiftKey ? 'prev' : 'next')
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
  // roving tabindexで管理する（039-tab-reorder-keyboard-nav Decision 2）。新規タブは
  // 追加直後に必ず`setActiveTab`→`setActiveTabUi`が呼ばれ`updateRovingTabindex`で
  // 確定するため、ここでは非アクティブ値（-1）で作成する。
  el.tabIndex = -1
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
    // Tabキーでの到達対象から除外する（039-tab-reorder-keyboard-nav Decision 2）。
    // キーボードからの切替はtab-bar__tab側のスペースキーに一本化する（FR-014）。
    rawToggleEl.tabIndex = -1
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
  // Tabキーでの到達対象から除外する（039-tab-reorder-keyboard-nav Decision 2）。
  // キーボードからのクローズはtab-bar__tab側のDelete/Ctrl+Wキーに一本化する（FR-019）。
  closeEl.tabIndex = -1
  closeEl.addEventListener('click', (event) => {
    event.stopPropagation()
    callbacks?.onClose(tabId)
  })

  el.append(spinnerEl, labelEl, ...(rawToggleEl ? [rawToggleEl] : []), closeEl)
  el.addEventListener('click', () => {
    if (suppressClickForTabId === tabId) {
      // ドラッグ確定直後のclick発火であり、タブをアクティブ化してはならない（FR-001a）
      suppressClickForTabId = null
      return
    }
    callbacks?.onActivate(tabId)
  })
  el.addEventListener('keydown', (event) => handleTabKeydown(event, tabId))
  initTabDrag(el, tabId)

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

/**
 * tab塊をroving tabindexの単一停止点として維持する（039-tab-reorder-keyboard-nav
 * Decision 2）。アクティブなタブのみ`tabIndex = 0`とし、他のタブ本体は`-1`にする。
 * RAW切替・閉じるボタンは常時`-1`（Tab到達対象から除外済み、`addTab`参照）。
 */
function updateRovingTabindex(activeTabId: string): void {
  for (const [id, state] of tabElements) {
    state.el.tabIndex = id === activeTabId ? 0 : -1
  }
}

export function setActiveTabUi(tabId: string): void {
  for (const [id, state] of tabElements) {
    state.el.classList.toggle('is-active', id === tabId)
  }
  updateRovingTabindex(tabId)
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
