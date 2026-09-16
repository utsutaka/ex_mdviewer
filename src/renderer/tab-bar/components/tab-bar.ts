import type { DisplayMode, FileKind } from '@shared/types'
import { isRawToggleSupported } from '@shared/file-kind'

export interface TabBarCallbacks {
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  /** raw表示切替ボタンのクリック（019-raw-source-toggle FR-001） */
  onToggleDisplayMode: (tabId: string) => void
}

/** タブバーの段（041-two-row-tab-bar spec.md 上段/下段）。固定2値、本feature範囲では増減しない */
export type Row = 'upper' | 'lower'

interface TabElementState {
  tabId: string
  el: HTMLDivElement
  /** markdown/html以外のfileKindではボタン自体を生成しないためnull（FR-011） */
  rawToggleEl: HTMLButtonElement | null
}

/**
 * タブの実体は上段・下段を通じて単一のMapで管理する（041-two-row-tab-bar実装上の決定）。
 * research.md Decision 4は当初「段ごとに独立したクロージャ（createTabRowファクトリ）」を
 * 想定していたが、その設計だとタブ要素の生成時に閉じ込めたイベントリスナー（`initTabDrag`・
 * `handleTabKeydown`が参照する`getTabBarEl()`相当）が「生成時点の段」に固定されてしまい、
 * 段またぎドラッグでDOM上の親要素を`insertBefore`で付け替えても、リスナー内部の判定は
 * 古い段を参照し続けるという不整合が生じることが実装検証で判明した。
 * 単一Mapのまま「そのタブが現在どちらの段のDOMに属するか」を`getRowOf`で都度動的に
 * 判定する設計に変更することで、段またぎ移動は`insertBefore`によるDOM移動のみで完結し、
 * ロービングタブインデックス（`updateRovingTabindex`）・入場フォーカス（`onFocusCycleEntered`）も
 * 上段・下段を横断して自然に単一の到達点であり続ける（FR-020a, FR-020b が特別な調整なしに
 * 成立する）。research.md Decision 4・Decision 9はこの実装に合わせて後日更新する。
 */
const tabElements = new Map<string, TabElementState>()
let callbacks: TabBarCallbacks | null = null

/**
 * 各段が最後にアクティブ化したタブID（FR-011）。`setActiveTabUi`のたびに更新し、
 * `removeTab`でそのタブが削除された場合は同じ段の残りタブの先頭へフォールバックする。
 */
const lastActiveTabIdByRow: Record<Row, string | null> = { upper: null, lower: null }

/** タブ1件あたりの固定幅（px）。既存の縮小方式における上限値を踏襲する（029-tab-toc-improvements Assumptions） */
const TAB_WIDTH = 220

function getRowEl(row: Row): HTMLElement {
  const id = row === 'upper' ? 'tab-bar-upper' : 'tab-bar-lower'
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`tab-bar element not found for row: ${row}`)
  }
  return el
}

/**
 * 指定タブIDが現在DOM上でどちらの段に属しているかを動的に判定する（041-two-row-tab-bar）。
 * 段またぎドラッグ（`insertBefore`によるDOM移動のみ）の結果を常に正しく反映する
 * ため、モジュール変数へキャッシュせずその都度`closest`で判定する。
 */
export function getRowOf(tabId: string): Row {
  const el = tabElements.get(tabId)?.el
  return el?.closest('.tab-bar')?.id === 'tab-bar-lower' ? 'lower' : 'upper'
}

/**
 * 指定した段の最後にアクティブ化されたタブID（FR-011, FR-017）。
 * 段またぎドラッグ（FR-008）でタブが移動してきただけでまだ一度もその段でアクティブ化
 * されていない場合、`lastActiveTabIdByRow`は`null`のままだが、その段にタブが存在する
 * 限り何らかのタブへ切り替えられる必要があるため、DOM順の先頭タブへフォールバックする。
 */
export function getLastActiveTabId(row: Row): string | null {
  return lastActiveTabIdByRow[row] ?? orderedTabIds(row)[0] ?? null
}

/**
 * `lastActiveTabIdByRow[row]`が`tabId`を指している場合、その段の残りタブの先頭へ
 * フォールバックする（実装時に発見した不整合への対処: タブが削除された場合だけでなく、
 * 段またぎドラッグで他の段へ移動した場合も、移動元の段の記憶がもう実体のないタブを
 * 指したまま残ってしまう。`removeTab`・段またぎドラッグ確定処理の両方から呼ぶ）。
 */
function invalidateStaleLastActive(row: Row, tabId: string): void {
  if (lastActiveTabIdByRow[row] === tabId) {
    lastActiveTabIdByRow[row] = orderedTabIds(row)[0] ?? null
  }
}

/** 二段バーの下段の可視状態を切り替える（FR-002, FR-005, FR-006）。上段は常時表示のため対象外 */
export function setRowVisible(row: Row, visible: boolean): void {
  const wrapper = getRowEl(row).closest<HTMLElement>('.tab-bar-wrapper')
  if (wrapper) {
    wrapper.hidden = !visible
  }
}

function getScrollButtons(row: Row): { left: HTMLButtonElement; right: HTMLButtonElement } {
  const wrapper = getRowEl(row).parentElement
  const left = wrapper?.querySelector<HTMLButtonElement>('.tab-bar-scroll-btn--left')
  const right = wrapper?.querySelector<HTMLButtonElement>('.tab-bar-scroll-btn--right')
  if (!left || !right) {
    throw new Error(`tab-bar scroll buttons not found for row: ${row}`)
  }
  return { left, right }
}

/**
 * タブバーのスクロール位置に応じて左右スクロールボタンの表示可否を更新する（FR-004, FR-007）。
 * `addTab`/`removeTab`（タブ数の増減）、`scroll`イベント、`ResizeObserver`（ウィンドウリサイズ）の
 * いずれの契機でも呼び出す。`ResizeObserver`は`#tab-bar-upper`/`#tab-bar-lower`自身の
 * content-boxサイズ変化のみを監視し、子要素増加によるscrollWidthのみの変化は検知できないため、
 * `addTab`からの明示呼び出しが必須（research.md Decision 1、`/speckit-analyze` finding U1対応）。
 * 041-two-row-tab-bar: 上段・下段それぞれ専用のスクロールボタンを持つため、`row`引数で対象を
 * 指定する（FR-007、他方の段のスクロール状態に影響しない）。
 */
function updateScrollButtonsVisibility(row: Row): void {
  const bar = getRowEl(row)
  const { left, right } = getScrollButtons(row)
  const maxScrollLeft = bar.scrollWidth - bar.clientWidth
  left.hidden = bar.scrollLeft <= 0
  right.hidden = bar.scrollLeft >= maxScrollLeft - 1
}

/**
 * 対象タブが現在のタブバー表示範囲外にある場合、タブバーをスクロールして
 * 表示範囲の中央付近に収める（FR-006）。対象タブが属する段を動的に判定して操作する。
 */
function scrollTabIntoViewIfNeeded(tabId: string): void {
  const state = tabElements.get(tabId)
  if (!state) {
    return
  }
  const bar = getRowEl(getRowOf(tabId))
  const el = state.el
  const isVisible = el.offsetLeft >= bar.scrollLeft && el.offsetLeft + el.offsetWidth <= bar.scrollLeft + bar.clientWidth
  if (isVisible) {
    return
  }
  const elCenter = el.offsetLeft + el.offsetWidth / 2
  const targetScrollLeft = elCenter - bar.clientWidth / 2
  bar.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
}

/** 左右スクロールボタンのクリック・自動再評価（scroll/resize）を配線する（FR-001〜FR-005）。段ごとに1回ずつ呼ぶ */
function initTabBarScroll(row: Row): void {
  const bar = getRowEl(row)
  const { left, right } = getScrollButtons(row)

  left.addEventListener('click', () => {
    bar.scrollBy({ left: -TAB_WIDTH, behavior: 'smooth' })
  })
  right.addEventListener('click', () => {
    bar.scrollBy({ left: TAB_WIDTH, behavior: 'smooth' })
  })

  bar.addEventListener('scroll', () => updateScrollButtonsVisibility(row))

  const resizeObserver = new ResizeObserver(() => updateScrollButtonsVisibility(row))
  resizeObserver.observe(bar)

  updateScrollButtonsVisibility(row)
}

export function initTabBar(cb: TabBarCallbacks): void {
  callbacks = cb
  initTabBarScroll('upper')
  initTabBarScroll('lower')
  // 塊への入場時（Tab/Shift+Tabで他の塊からtab塊へ移動してきた場合）、現在アクティブな
  // タブへフォーカスする（039-tab-reorder-keyboard-nav、research.md Decision 5）。
  // tabElementsは上段・下段を横断する単一Mapのため、二段バー有効時も追加の分岐なしに
  // 現在アクティブなタブ（`is-active`）を正しく検出できる（FR-020a）。
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
let dragStartY = 0
let dragLastClientX = 0
let dragLastClientY = 0
let hasDraggedPastThreshold = false
/** ドラッグ確定直後に発火するclickイベントでタブがアクティブ化されるのを防ぐ（FR-001a） */
let suppressClickForTabId: string | null = null

/**
 * 現在のポインタX座標を基準に、ドロップ予定位置（挿入先の参照要素）を求める
 * （039-tab-reorder-keyboard-nav FR-001〜FR-003, FR-005）。他のタブの中心を基準に決める。
 * `null`は末尾への挿入を意味する。`bar`はドロップ対象の段のコンテナ（041-two-row-tab-bar
 * では自段・他段いずれも指定されうる、FR-008）。
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
 * ポインタ座標からドロップ対象の段を判定する（041-two-row-tab-bar FR-008、research.md Decision 5）。
 * `elementFromPoint`が`.tab-bar`要素（またはその子孫）を指していなければ既定で'upper'を返す
 * （スクロールボタン上や余白でドロップした場合の妥当なフォールバック）。
 */
function findRowAtPoint(clientX: number, clientY: number): Row {
  const target = document.elementFromPoint(clientX, clientY)
  const container = target?.closest('.tab-bar')
  return container?.id === 'tab-bar-lower' ? 'lower' : 'upper'
}

/**
 * ポインタが上段・下段どちらの表示範囲にも入っていないかを判定する（FR-005、無効な位置への
 * ドロップの検出）。二段バーOFF時、下段は非表示（`hidden`）のため矩形が縮退し常に「範囲外」
 * 判定になる（誤って有効なドロップ先とみなされることはない）。
 */
function isPointOutsideAllRows(clientX: number, clientY: number): boolean {
  const rows: Row[] = ['upper', 'lower']
  return rows.every((row) => {
    const rect = getRowEl(row).getBoundingClientRect()
    return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom
  })
}

/**
 * ドロップ予定位置の参照要素に、視覚的な挿入位置インジケーターを付与する（FR-002）。
 * ドラッグ中は実際のDOM移動を行わない（`insertBefore`によるDOM移動はPointer Captureを
 * 喪失させ、以降の`pointermove`/`pointerup`が発火しなくなる実機不具合が確認されたため、
 * research.md「残存する技術的リスク」記載の懸念が実際に顕在化した。DOM移動はドロップ確定時
 * 〈`pointerup`〉の1回のみに限定し、ドラッグ中は`transform`によるライブ追従とクラス付与
 * のみで視覚的に示す）。tabElementsは上段・下段を横断する単一Mapのため、段をまたいだ
 * インジケーターの付け替えも追加の分岐なしに正しく動作する。
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
  dragLastClientY = 0
}

/**
 * `is-dragging`（`position: fixed`、041-two-row-tab-bar実機フィードバック対応）に伴い
 * インラインで設定した`left`/`top`/`width`/`height`/`transform`を解除し、通常フローの
 * 表示へ戻す。ドロップ確定・無効な位置への解除・ドラッグ取消のいずれからも呼ぶ。
 */
function clearDragVisualStyles(el: HTMLDivElement): void {
  el.classList.remove('is-dragging')
  el.style.transform = ''
  el.style.left = ''
  el.style.top = ''
  el.style.width = ''
  el.style.height = ''
}

/**
 * タブ要素へのPointer Eventsによるドラッグ並び替え（039-tab-reorder-keyboard-nav
 * FR-001〜FR-005, FR-001a）。既存の「タブバー領域への外部ファイルドラッグ&ドロップで
 * 開く」機能（`tab-bar/main.ts`のネイティブHTML5 D&D）とは`DataTransfer`を介さず、
 * 実装上完全に独立している（research.md Decision 3）。
 * 041-two-row-tab-bar: `pointermove`中のポインタ座標からドロップ対象の段を判定し、
 * `pointerup`確定時にその段のコンテナへ`insertBefore`/`appendChild`することで、
 * 同一段内の並び替え・段またぎ移動のいずれも同じロジックで扱う（FR-008、research.md Decision 5）。
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
    // 041-two-row-tab-bar実機フィードバック対応: `user-select: none`（components.css）に
    // 加えて、mousedown由来の既定動作（テキスト選択・選択済みテキストのネイティブドラッグ
    // 開始等）を明示的に抑止する。既定動作の抑止はclickイベントの発火を妨げないが、
    // 「mousedownで対象要素にDOMフォーカスが移る」というブラウザ既定動作も同時に
    // 抑止してしまい、クリック後に矢印キーでの操作が一切効かなくなる回帰を実機
    // フィードバックで確認した。抑止した既定動作の代わりに明示的に`el.focus()`する
    event.preventDefault()
    el.focus()
    draggingTabId = tabId
    dragPointerId = event.pointerId
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragLastClientX = event.clientX
    dragLastClientY = event.clientY
    hasDraggedPastThreshold = false
    el.setPointerCapture(event.pointerId)
  })

  el.addEventListener('pointermove', (event) => {
    if (draggingTabId !== tabId || dragPointerId !== event.pointerId) {
      return
    }
    if (!hasDraggedPastThreshold) {
      // 041-two-row-tab-bar実機フィードバック対応: 当初は横方向の移動量のみでしきい値を
      // 判定していたため、下段へまっすぐ下方向にドラッグする（横方向の移動がほぼ無い）
      // 操作でドラッグ自体が一切開始されない不具合があった。段またぎドラッグ（FR-008）は
      // 縦方向の移動が主となる操作のため、縦横いずれかの移動量がしきい値を超えれば
      // ドラッグ開始とみなす。
      const dx = Math.abs(event.clientX - dragStartX)
      const dy = Math.abs(event.clientY - dragStartY)
      if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
        return
      }
      hasDraggedPastThreshold = true
      // 041-two-row-tab-bar実機フィードバック対応: `is-dragging`は`position: fixed`を
      // 適用する（各段の`.tab-bar`のoverflow-y: hiddenによるクリッピングを回避するため、
      // components.css参照）。`position: fixed`は`left`/`top`を明示しないと通常フローから
      // 外れた瞬間に位置が飛んでしまうため、クラス付与前（まだ通常フロー中）の実際の
      // 表示位置を`getBoundingClientRect()`で取得し、`left`/`top`/`width`/`height`として
      // 固定してから`is-dragging`を付与する。以降のtransformはこの固定位置からの
      // 相対移動として機能し続ける。
      const rect = el.getBoundingClientRect()
      el.style.left = `${rect.left}px`
      el.style.top = `${rect.top}px`
      el.style.width = `${rect.width}px`
      el.style.height = `${rect.height}px`
      el.classList.add('is-dragging')
    }
    dragLastClientX = event.clientX
    dragLastClientY = event.clientY
    // DOM移動はまだ行わず、transformによる追従とドロップ位置インジケーターのみ更新する。
    // 段またぎ移動の視覚的な追従が自然になるよう、横方向に加えて縦方向にも追従させる
    // （041-two-row-tab-bar実機フィードバック対応）。
    el.style.transform = `translate(${event.clientX - dragStartX}px, ${event.clientY - dragStartY}px)`
    const targetRow = findRowAtPoint(event.clientX, event.clientY)
    updateDropIndicator(findDropReference(getRowEl(targetRow), el, event.clientX))
  })

  el.addEventListener('pointerup', (event) => {
    if (draggingTabId !== tabId || dragPointerId !== event.pointerId) {
      return
    }
    el.releasePointerCapture(event.pointerId)
    clearDragVisualStyles(el)
    clearDropIndicator()

    if (hasDraggedPastThreshold) {
      if (isPointOutsideAllRows(dragLastClientX, dragLastClientY)) {
        // 上段・下段いずれの範囲外へのドロップも無効とし、元の位置のまま変更しない（FR-005）
      } else {
        const sourceRow = getRowOf(tabId)
        const targetRow = findRowAtPoint(dragLastClientX, dragLastClientY)
        const targetBar = getRowEl(targetRow)
        // ドロップ確定時にのみDOM上の位置を1回だけ確定させる（research.md参照）。
        // 同一段内・段またぎのいずれも同じ`insertBefore`/`appendChild`で完結する（FR-008）。
        const reference = findDropReference(targetBar, el, dragLastClientX)
        if (reference) {
          targetBar.insertBefore(el, reference)
        } else {
          targetBar.appendChild(el)
        }
        // 041-two-row-tab-bar実機フィードバック対応: `insertBefore`/`appendChild`による
        // DOM上の親要素の付け替えは、そのタブがドラッグ開始時（pointerdown）にDOMフォーカス
        // を持っていても、移動後にフォーカスが失われる（`document.activeElement`が
        // 別の要素または`body`になる）ことが実機で確認された。ドロップ確定後に明示的に
        // 再度フォーカスし、「もう一度マウスでクリックしないと矢印キーが効かない」状態を防ぐ
        el.focus()
        // 段をまたいだ場合、移動元の段の「最後にアクティブだったタブ」の記憶がこのタブを
        // 指していれば、もう実体がないため無効化する（実装時に発見した不整合への対処）
        if (sourceRow !== targetRow) {
          invalidateStaleLastActive(sourceRow, tabId)
        }
        // 移動元・移動先どちらの段も表示件数が変わりうるため両方を再評価する
        updateScrollButtonsVisibility('upper')
        updateScrollButtonsVisibility('lower')
      }
      suppressClickForTabId = tabId
    }

    resetDragState()
  })

  el.addEventListener('pointercancel', () => {
    if (draggingTabId !== tabId) {
      return
    }
    clearDragVisualStyles(el)
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
 * 指定した段のタブの並び順は、`tabElements`（Mapの挿入順）ではなくその段のコンテナの
 * DOM上の実際の子要素順を正とする（039-tab-reorder-keyboard-nav、research.md Decision 4）。
 * ドラッグ＆ドロップによる並び替え・段またぎ移動はDOM上の要素移動のみで完結し、この関数を
 * 経由する既存の全ロジック（矢印キー切替・自動スクロール・横スクロールボタン表示判定・
 * 上下キーでの段切替）が変更なしに新しい並び順へ追随する。
 */
export function orderedTabIds(row: Row): string[] {
  const bar = getRowEl(row)
  const children = Array.from(bar.children).map((el) => ({ tabId: (el as HTMLElement).dataset.tabId }))
  return tabIdsFromDomOrder(children)
}

/**
 * 上下キー押下時の段切替対象を求める純粋関数（041-two-row-tab-bar FR-012, FR-013, FR-013a、
 * data-model.md）。対応する方向に段自体が存在しない場合（上段で'up'、下段で'down'）、または
 * 対応する方向の段のタブ数が0の場合は`null`を返す。
 */
export function resolveRowSwitchTarget(
  direction: 'up' | 'down',
  currentRow: Row,
  tabCounts: Record<Row, number>
): Row | null {
  if (direction === 'up') {
    if (currentRow === 'upper') {
      return null
    }
    return tabCounts.upper > 0 ? 'upper' : null
  }
  if (currentRow === 'lower') {
    return null
  }
  return tabCounts.lower > 0 ? 'lower' : null
}

/**
 * 二段バーOFF切替時のタブ統合順序（上段→下段の順に連結）を返す純粋関数
 * （041-two-row-tab-bar FR-019、data-model.md）。
 */
export function mergeRowsForSingleBar(upperIds: string[], lowerIds: string[]): string[] {
  return [...upperIds, ...lowerIds]
}

/**
 * 二段バーをOFFにする際、下段の全タブを上段の末尾へ、上段→下段の順の並びで統合する
 * （FR-019）。直前にアクティブだったタブの`is-active`クラス・ロービングタブインデックスは
 * 変更しない（`is-active`はDOM上の位置に依存しないクラスであり、要素の親を付け替えても
 * 保持される）。
 */
export function mergeLowerIntoUpper(): void {
  const upperBar = getRowEl('upper')
  const mergedIds = mergeRowsForSingleBar(orderedTabIds('upper'), orderedTabIds('lower'))
  for (const tabId of mergedIds) {
    const state = tabElements.get(tabId)
    if (state) {
      upperBar.appendChild(state.el)
    }
  }
  updateScrollButtonsVisibility('upper')
  updateScrollButtonsVisibility('lower')
}

/**
 * tab塊内のキー操作（039-tab-reorder-keyboard-nav FR-012〜FR-018、
 * 041-two-row-tab-bar FR-012〜FR-013a, FR-021a）。
 * 左右矢印キーで同一段内のタブ切替（自動スクロールは`setActiveTabUi`経由の
 * `scrollTabIntoViewIfNeeded`で担保）、上下キーで段の切替（FR-012, FR-013, FR-013a）、
 * EnterキーのみでタブをアクティブID化（FR-015）、スペースキーでRAW表示切替（FR-014）、
 * Delete/Ctrl+Wキーでクローズ（FR-019、既存維持）、Tab/Shift+Tabキーで塊外
 * （次/前の塊）へ直接離脱する（FR-017, FR-018）。
 */
function handleTabKeydown(event: KeyboardEvent, tabId: string): void {
  const row = getRowOf(tabId)
  const ids = orderedTabIds(row)
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
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    // 041-two-row-tab-bar FR-012, FR-013, FR-013a: 段の切替。左右矢印キーとは異なり
    // 段をまたぐが、対象がない場合（FR-013/FR-013a）はフォーカス・本文表示を変更しない。
    event.preventDefault()
    const direction = event.key === 'ArrowUp' ? 'up' : 'down'
    const tabCounts: Record<Row, number> = { upper: orderedTabIds('upper').length, lower: orderedTabIds('lower').length }
    const targetRow = resolveRowSwitchTarget(direction, row, tabCounts)
    if (targetRow === null) {
      return
    }
    const targetTabId = getLastActiveTabId(targetRow)
    if (!targetTabId) {
      return
    }
    tabElements.get(targetTabId)?.el.focus()
    callbacks?.onActivate(targetTabId)
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
 * 041-two-row-tab-bar: `row`引数で追加先の段（上段/下段）を指定する（FR-005, FR-015）。
 */
export function addTab(tabId: string, filePath: string, title: string, fileKind: FileKind, row: Row): void {
  const bar = getRowEl(row)

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
  updateScrollButtonsVisibility(row)
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
  const row = getRowOf(tabId)
  state.el.remove()
  tabElements.delete(tabId)
  invalidateStaleLastActive(row, tabId)
  updateScrollButtonsVisibility(row)
}

/**
 * tab塊をroving tabindexの単一停止点として維持する（039-tab-reorder-keyboard-nav
 * Decision 2）。アクティブなタブのみ`tabIndex = 0`とし、他のタブ本体は`-1`にする。
 * RAW切替・閉じるボタンは常時`-1`（Tab到達対象から除外済み、`addTab`参照）。
 * tabElementsは上段・下段を横断する単一Mapのため、二段バー有効時も`tabIndex=0`は
 * 常にちょうど1件のみになる（FR-020b、追加の段間調整は不要）。
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
  // 041-two-row-tab-bar FR-011: そのタブが属する段の「最後にアクティブだったタブ」を更新する
  lastActiveTabIdByRow[getRowOf(tabId)] = tabId
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

/** 指定した段の先頭タブID（041-two-row-tab-bar: `039`当時の無引数版から段指定へ変更） */
export function firstTabId(row: Row): string | undefined {
  return orderedTabIds(row)[0]
}
