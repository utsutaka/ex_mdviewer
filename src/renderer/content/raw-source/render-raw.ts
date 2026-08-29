/**
 * 033-webcontentsview-search-fix: タブバーView（アイコン表示判定）・本文View（実際の
 * 表示切替）の双方から参照するためshared/file-kind.tsへ移動した。既存importパスを
 * 壊さないようre-exportする。
 */
export { isRawToggleSupported } from '@shared/file-kind'

/**
 * 生データ表示を描画する（FR-002, FR-003, FR-014）。専用の装飾（バッジ・背景色等）を持たず、
 * 空ファイルの場合は既存の空ファイルメッセージパターン（render-html.ts）と同様のメッセージを表示する。
 */
export function renderRawSourceInto(containerEl: HTMLDivElement, rawContent: string): void {
  containerEl.textContent = ''

  if (rawContent === '') {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'document-pane__empty-message'
    emptyEl.textContent = '空のファイルです'
    containerEl.appendChild(emptyEl)
    return
  }

  const pre = document.createElement('pre')
  pre.className = 'raw-source-view'
  pre.textContent = rawContent
  containerEl.appendChild(pre)
}
