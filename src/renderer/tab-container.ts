import type { FileKind } from '@shared/types'

/**
 * fileKindごとのタブコンテナ要素のクラス名を決定する（011-html-pdf-viewer）。
 * markdown/htmlは通常のページ表示（document-pane）、pdfは専用のiframeホスト（pdf-pane）、
 * json/yaml/xmlは既存のツリービューア（structured-tree）を使う。
 * htmlの場合のみ判別用クラスdocument-pane--htmlを付与し、markdown-content.cssの
 * pre/code背景色ルールをMarkdown表示にのみ限定できるようにする（015-fix-html-codeblock-bg FR-004）。
 * main.tsから独立したモジュールに切り出しているのは、main.tsがモジュール末尾で
 * トップレベルのinit()（window.api等のElectron APIに依存）を実行するため、
 * 単体テストからmain.tsを直接importできないことによる（015-fix-html-codeblock-bg research.md Decision 3）。
 */
export function resolveContainerClassName(fileKind: FileKind): string {
  if (fileKind === 'html') {
    return 'document-pane document-pane--html'
  }
  if (fileKind === 'markdown') {
    return 'document-pane'
  }
  if (fileKind === 'pdf') {
    return 'pdf-pane'
  }
  return 'structured-tree'
}
