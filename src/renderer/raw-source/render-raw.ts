import type { FileKind } from '@shared/types'

/**
 * raw表示切替の対象fileKindかどうかを判定する（019-raw-source-toggle FR-011）。
 * Markdown・HTMLタブのみが対象で、JSON/YAML/XML・PDFにはトグルアイコン自体を表示しない。
 */
export function isRawToggleSupported(fileKind: FileKind): boolean {
  return fileKind === 'markdown' || fileKind === 'html'
}

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
