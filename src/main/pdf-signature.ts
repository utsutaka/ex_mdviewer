const PDF_MAGIC_BYTES = '%PDF-'

/**
 * PDFファイルの先頭バイトが`%PDF-`で始まるかを判定する（011-html-pdf-viewer FR-019）。
 * broken.pdf（実際にはPDFではないファイル）をChromium内蔵PDFビューアにそのまま渡すと、
 * ビューア自体が表示するエラー画面の「再読み込み」ボタンにより、mdviewerのメインウィンドウ
 * 全体が意図せず再読み込みされ開いているタブがすべて失われる不具合が実機で確認された
 * （research.md Decision 8）。この事前チェックにより、そもそもPDFとして解釈できない
 * ファイルをPDFビューアへ渡さないようにする。内部構造が壊れている本物のPDF（先頭バイトは
 * 正しいがパースに失敗するもの）まではこのチェックでは検知できない。
 */
export function isPdfSignatureValid(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC_BYTES.length).toString('latin1') === PDF_MAGIC_BYTES
}
