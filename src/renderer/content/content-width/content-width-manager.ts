import type { ContentWidthMode } from '@shared/types'

let currentContentWidthMode: ContentWidthMode = 'readable'

export function getContentWidthMode(): ContentWidthMode {
  return currentContentWidthMode
}

function applyContentWidthModeClass(mode: ContentWidthMode): void {
  document.documentElement.classList.toggle('content-width-full', mode === 'full')
}

/**
 * 本文表示幅モードを切り替え、AppSettingsへ永続化する（FR-001〜FR-003）。
 * DOM要素の再構築を伴わないクラス切替のみのため、各タブのスクロール位置は
 * ブラウザの標準的なリフロー挙動によりこの呼び出しだけで維持される（FR-010, research.md Decision 2）。
 */
export function setContentWidthMode(mode: ContentWidthMode): void {
  currentContentWidthMode = mode
  applyContentWidthModeClass(mode)
  window.contentApi.contentWidthModeChanged(mode)
}

/** 起動時、または他Viewからの`content-width-mode-updated`受信時に適用する（IPC送出は行わない） */
export function initContentWidthMode(initialMode: ContentWidthMode): void {
  currentContentWidthMode = initialMode
  applyContentWidthModeClass(initialMode)
}
