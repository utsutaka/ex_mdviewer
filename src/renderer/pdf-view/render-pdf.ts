import type { FileOpenedPayload, PdfPageInfoPayload } from '@shared/types'
import type { TabRuntime } from '../main'

/**
 * Windowsファイルパスをfile:// URLへ変換する（`node:path`がrenderer環境では使えないための自前実装）。
 * ドライブレター（例: "E:"）はそのまま維持し、それ以外の各パスセグメントを個別にURIエンコードする
 * ことで、日本語・スペース・`#`を含むパスでも正しいURLになる（011-html-pdf-viewer research.md Decision 4）。
 */
function filePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const encoded = segments
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return `file:///${encoded}`
}

/**
 * PDFファイルをChromium内蔵PDFビューアで表示する（011-html-pdf-viewer FR-005〜FR-006, FR-013, FR-014, FR-016, FR-019）。
 * PDFはバイナリのため既存のテキスト読込パイプラインには乗らず、`filePath`を`file://` URLへ変換して
 * `<iframe>`のsrcに設定する（research.md Decision 4）。`#toolbar=0`によりツールバーを常時非表示にする（FR-006）。
 * `payload.isInvalidPdf`（先頭バイトが`%PDF-`と一致しない）の場合はそもそも`<iframe>`を生成しない。
 * PDFとして解釈できないファイルをPDFビューアにそのまま渡すと、ビューア自体が表示するエラー画面の
 * 「再読み込み」ボタンにより、mdviewerのメインウィンドウ全体が意図せず再読み込みされタブが
 * すべて失われる不具合が実機で確認されたため（FR-019、research.md Decision 8）。
 * ページ位置表示欄（`.pdf-page-indicator`）はここで非表示状態のまま生成しておき、
 * `pdf-page-info`通知を受けた時点で`updatePdfPageIndicator()`が表示・更新する（FR-017）。
 */
export function renderPdfDocumentInto(tab: TabRuntime, payload: FileOpenedPayload): void {
  tab.containerEl.innerHTML = ''

  if (payload.isEmptyFile) {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'pdf-pane__empty-message'
    emptyEl.textContent = '空のファイルです'
    tab.containerEl.appendChild(emptyEl)
    return
  }

  if (payload.isInvalidPdf) {
    const invalidEl = document.createElement('div')
    invalidEl.className = 'pdf-pane__empty-message'
    invalidEl.textContent = 'PDFファイルとして読み込めませんでした'
    tab.containerEl.appendChild(invalidEl)
    return
  }

  const iframe = document.createElement('iframe')
  iframe.className = 'pdf-pane__frame'
  // name属性をtabIdに設定し、mainプロセス側（pdf-page-tracker.ts）が
  // WebFrameMain.nameで対象タブのフレームを一意に特定できるようにする
  // （複数PDFタブが存在する場合に誤ったフレームを参照しないため）
  iframe.name = tab.tabId
  iframe.src = `${filePathToFileUrl(payload.filePath)}#toolbar=0`
  tab.containerEl.appendChild(iframe)

  const indicator = document.createElement('div')
  indicator.className = 'pdf-page-indicator'
  indicator.style.display = 'none'
  tab.containerEl.appendChild(indicator)
}

/**
 * `pdf-page-info`通知を受けてページ位置表示欄を更新する（FR-017）。
 * `pageNo`/`totalPages`が`null`の場合（取得失敗、research.md Decision 5 Risk）は
 * エラー通知せず表示欄自体を非表示にする。
 */
export function updatePdfPageIndicator(containerEl: HTMLElement, payload: PdfPageInfoPayload): void {
  const indicator = containerEl.querySelector<HTMLElement>('.pdf-page-indicator')
  if (!indicator) {
    return
  }
  if (payload.pageNo === null || payload.totalPages === null) {
    indicator.style.display = 'none'
    return
  }
  indicator.style.display = ''
  indicator.textContent = `${payload.pageNo}/${payload.totalPages}`
}
