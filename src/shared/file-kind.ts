/**
 * タブごとに1つ確定する表示種別（010-json-yaml-xml-viewer data-model.md「FileKind」）。
 * 拡張子↔FileKindの対応表をこのファイルに一元管理し、main/menu/ダイアログfiltersが
 * 共通参照する（010-json-yaml-xml-viewer research.md Decision 4）。
 * main/renderer双方からimportされるため、`node:path`等のNode.js専用APIには依存しない
 * （rendererはVite経由でブラウザ向けにバンドルされ、Node.js組み込みモジュールを解決できない）。
 */
export type FileKind = 'markdown' | 'json' | 'yaml' | 'xml' | 'html' | 'pdf'

const EXTENSION_TO_KIND: Record<string, FileKind> = {
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.html': 'html',
  '.htm': 'html',
  '.pdf': 'pdf'
}

/** 対応拡張子の一覧（ダイアログfilters等で参照、先頭のドットを含まない） */
export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_TO_KIND).map((ext) => ext.slice(1))

/** `node:path`の`extname`相当（ブラウザ環境でも動く自前実装） */
function extractExtension(filePath: string): string {
  const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const base = filePath.slice(lastSeparator + 1)
  const lastDot = base.lastIndexOf('.')
  if (lastDot <= 0) {
    return ''
  }
  return base.slice(lastDot)
}

/** ファイルパスの拡張子からFileKindを判定する。対応外の拡張子はnullを返す */
export function resolveFileKind(filePath: string): FileKind | null {
  return EXTENSION_TO_KIND[extractExtension(filePath).toLowerCase()] ?? null
}

/**
 * raw表示切替の対象fileKindかどうかを判定する（019-raw-source-toggle FR-011）。
 * Markdown・HTMLタブのみが対象で、JSON/YAML/XML・PDFにはトグルアイコン自体を表示しない。
 * 033-webcontentsview-search-fixでタブバーView（アイコン表示判定）・本文View
 * （実際の表示切替）の双方から参照するためshared化した。
 */
export function isRawToggleSupported(fileKind: FileKind): boolean {
  return fileKind === 'markdown' || fileKind === 'html'
}
