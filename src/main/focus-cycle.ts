import type { FocusBlockId } from '@shared/types'

/**
 * キーボードによるフォーカス移動の単位となる4塊の固定巡回順序（039-tab-reorder-keyboard-nav
 * FR-006〜FR-011、data-model.md FocusBlock）。浮遊検索バーは含まない（FR-010）。
 */
const FOCUS_BLOCK_ORDER: readonly FocusBlockId[] = ['tabBar', 'explorer', 'content', 'toc']

/**
 * 固定巡回順序と各塊の実効可視性から、次/前の対象塊を求める純粋関数（data-model.md FocusBlock）。
 * 可視性の判定自体（`openTabs.size`・`explorerVisible`・`isTocSidebarVisible()`）はこの関数の
 * 責務ではなく、呼び出し側（`ipc/handlers.ts`の`handleRequestFocusCycle`）が`visibility`として
 * 組み立てて渡す（research.md Decision 1、tasks.md T002/T004）。`electron`に依存しない独立
 * モジュールとすることで、ユニットテストが`electron`モジュールのモックを必要としないようにする。
 * 可視な塊が`from`自身しかない、または1つもない場合は`null`を返す。
 */
export function computeNextFocusBlock(
  from: FocusBlockId,
  direction: 'next' | 'prev',
  visibility: Record<FocusBlockId, boolean>
): FocusBlockId | null {
  const step = direction === 'next' ? 1 : -1
  const length = FOCUS_BLOCK_ORDER.length
  const startIndex = FOCUS_BLOCK_ORDER.indexOf(from)
  for (let i = 1; i <= length; i++) {
    const index = (((startIndex + step * i) % length) + length) % length
    const candidate = FOCUS_BLOCK_ORDER[index]
    if (candidate === from) {
      return null
    }
    if (visibility[candidate]) {
      return candidate
    }
  }
  return null
}
