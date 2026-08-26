/**
 * main/preload/renderer間で共有するデータモデル型定義。
 * data-model.mdのエンティティ定義に対応する。
 */

export type { FileKind } from './file-kind'
import type { FileKind } from './file-kind'

export type EncodingStatus = 'utf-8' | 'shift-jis' | 'euc-jp' | 'unrecognized'

export type DocumentLoadStatus = 'loading' | 'loaded' | 'missing'

export interface Heading {
  level: number
  text: string
  anchorId: string
  children: Heading[]
}

export type MermaidRenderStatus = 'pending' | 'rendered' | 'error'

export interface MermaidBlock {
  id: string
  sourceText: string
  renderStatus: MermaidRenderStatus
  errorMessage: string | null
}

export interface DocumentModel {
  filePath: string
  rawContent: string
  encodingStatus: EncodingStatus
  headings: Heading[]
  mermaidBlocks: MermaidBlock[]
  loadStatus: DocumentLoadStatus
  fileKind: FileKind
}

/**
 * JSON/YAML/XML共通の中間表現（010-json-yaml-xml-viewer data-model.md「StructuredNode」）。
 * JSON・YAML・XMLいずれのパース結果も、最終的にこの型のツリーへ変換されてから
 * ツリービューア（src/renderer/structured-data/tree-viewer.ts）に渡される。
 */
export type StructuredNodeKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'element'
  | 'attribute'
  | 'text'

export interface StructuredNode {
  kind: StructuredNodeKind
  key: string | null
  value: string | number | boolean | null
  children: StructuredNode[]
  anchorLabel: string | null
  /**
   * `anchorLabel`が非nullの場合、参照元アンカー定義ノードへのjsonPointer。
   * クリックでアンカー定義元へジャンプする機能に使用する（同一ドキュメント内限定）。
   */
  anchorRefPointer: string | null
  isRefAlias: boolean
  jsonPointer: string | null
}

/** YAML複数ドキュメント（`---`区切り）を表現するIPCペイロード専用の型 */
export interface YamlDocumentGroup {
  label: string
  root: StructuredNode
}

export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  isMaximized: boolean
}

export type Theme = 'light' | 'dark'

/** 本文表示幅のモード（FR-001）。readable: 現行の固定幅・中央寄せ、full: 上限1200px程度で追従 */
export type ContentWidthMode = 'readable' | 'full'

export interface AppSettings {
  theme: Theme
  tocVisible: boolean
  /** TOCサイドバーの幅（ピクセル単位の整数値、150〜480、アプリ全体で共通。021-toc-sidebar-resize FR-003, FR-005, FR-006） */
  tocWidth: number
  /** 本文表示幅のモード（アプリ全体で共通、FR-001〜FR-003） */
  contentWidthMode: ContentWidthMode
  /**
   * 過去にファイルが開かれたフォルダの絶対パスを新しい順に並べた一覧。最大10件、同一フォルダの
   * 重複は含まない（031-folder-history-menu FR-001〜FR-003）。旧`lastOpenedDirectory`（単一値、
   * 012-remember-last-directory）はこのフィールドへ統合され廃止された。
   */
  folderHistory: string[]
}

/** electron-storeに永続化するスキーマ全体（constitution原則VI） */
export interface PersistedStore {
  windowState: WindowState
  appSettings: AppSettings
}

// ---- IPCチャネルのペイロード定義（contracts/ipc-contract.md準拠） ----

export interface OpenFileRequest {
  filePath: string
}

export interface TabCreatedPayload {
  tabId: string
  filePath: string
  title: string
}

export interface FileOpenedPayload {
  tabId: string
  filePath: string
  rawContent: string
  encodingStatus: EncodingStatus
  headings: Heading[]
  loadStatus: 'loaded'
  fileKind: FileKind
  yamlDocuments: YamlDocumentGroup[] | null
  structuredParseError: boolean
  /** html/pdfでのみ意味を持つ（0バイトファイルの場合true）。それ以外のfileKindは常にfalse */
  isEmptyFile: boolean
  /** pdfでのみ意味を持つ（先頭バイトが`%PDF-`で始まらない、PDFとして解釈できないファイルの場合true）。それ以外のfileKindは常にfalse */
  isInvalidPdf: boolean
}

export interface UnsupportedFilePayload {
  filePath: string
}

export interface FileMissingPayload {
  tabId: string
  filePath: string
}

/**
 * ipc-contract.mdには明記されていないが、同一ファイルの重複オープン要求時に
 * 既存タブへフォーカスを戻すための通知チャネル（Assumptions、FR-038）。
 */
export interface FocusTabPayload {
  tabId: string
}

export interface CloseTabRequest {
  tabId: string
}

export interface CloseTabResponse {
  windowClosed: boolean
}

export interface ThemeChangedRequest {
  theme: Theme
}

export interface TocVisibilityChangedRequest {
  visible: boolean
}

/** TOCサイドバーの幅の変更をmainプロセスへ通知するペイロード（021-toc-sidebar-resize） */
export interface TocWidthChangedRequest {
  width: number
}

/** 本文表示幅モードの変更をmainプロセスへ通知するペイロード（013-content-width-toggle） */
export interface ContentWidthModeChangedRequest {
  mode: ContentWidthMode
}

/**
 * 「設定を保存する」のON/OFF切替時、設定の永続化先の作成・削除に失敗したことを
 * rendererへ通知するペイロード（005-native-menu-save-toggle FR-012）。
 */
export interface SettingsPersistenceErrorPayload {
  message: string
}

/**
 * 「ファイルを開く...」のネイティブダイアログ表示に失敗したことをrendererへ通知するペイロード
 * （009-native-menu-file-edit Convergence T010、Constitution V）。
 */
export interface OpenFileDialogErrorPayload {
  message: string
}

// ---- ページ内検索（webContents.findInPage連携、FR-005） ----
// ipc-contract.mdには明記されていないが、findInPageはmainプロセス専有APIのため
// IPC経由での仲介が必須であり、実装時に追加した内部チャネル。

export interface FindInPageRequest {
  text: string
  forward: boolean
  findNext: boolean
}

export interface StopFindInPageRequest {
  action: 'clearSelection' | 'keepSelection'
}

export interface FindInPageResultPayload {
  activeMatchOrdinal: number
  matches: number
}

// ---- PDFページ位置表示（011-html-pdf-viewer FR-017, FR-018） ----

/** PDFページ番号ポーリング結果の通知ペイロード（main → renderer） */
export interface PdfPageInfoPayload {
  tabId: string
  pageNo: number | null
  totalPages: number | null
}

/** PDFタブのアクティブ/非アクティブ通知（renderer → main、ページ番号ポーリングの開始・停止トリガー） */
export interface PdfTabActiveChangedRequest {
  tabId: string
  active: boolean
}
