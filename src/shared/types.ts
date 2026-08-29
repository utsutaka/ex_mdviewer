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

/**
 * フォーカス位置に関わらず動作するF3/Shift+F3による次/前候補移動の要求
 * （実機フィードバック対応: 検索欄・移動ボタン以外にフォーカスがあっても移動できるようにする）。
 * 4View全て（本文View・タブバーView・TOCサイドバーView・フロート検索View）から送出されうる。
 * mainプロセス側は現在アクティブなタブの検索文字列（`searchTextByTabId`）を用いて
 * `findNext: false`（既存セッションの続行、`search-float/main.ts`の`search`関数コメント参照）
 * で`findInPage`を実行する。
 */
export interface RequestFindNextRequest {
  forward: boolean
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

// ---- 033-webcontentsview-search-fix: 4View分離（タブバーView・TOCサイドバーView・
// フロート検索View・本文View）に伴う新規IPCペイロード型（contracts/ipc-contract-delta.md） ----

/** Markdown/HTMLタブの表示モード（レンダリング表示⇔生データ表示、019-raw-source-toggle FR-001〜FR-004）。
 * 033でsrc/renderer/main.tsから移動し、タブバーView・本文View双方が参照する共有型とした */
export type DisplayMode = 'rendered' | 'raw'

/** TOCサイドバーの見出しクリック時、本文View側の該当見出しへスクロールジャンプする要求（FR-008） */
export interface NavigateToHeadingRequest {
  tabId: string
  anchorId: string
}

/** 検索欄フォーカス中のPageUp/PageDownキー押下による本文スクロール要求（FR-012） */
export interface ScrollContentRequest {
  direction: 'up' | 'down'
}

/** 検索バーの使用状況の通知（FR-011、FocusLockState） */
export interface SearchFocusStateChangedRequest {
  inUse: boolean
  view: 'toc' | 'float'
}

/** 新規タブ作成時、本文View側にTabContentCacheエントリを生成させる通知（既存TabCreatedPayloadと同一形状） */
export type TabContentCreatedPayload = TabCreatedPayload

/** タブクローズ時、本文View側のTabContentCacheエントリを破棄させる通知（FR-013） */
export interface TabContentClosedPayload {
  tabId: string
}

/** タブ切り替え時、本文View側でアクティブタブのDOMノードを再アタッチさせる通知（FR-008, FR-009） */
export interface ActivateTabContentPayload {
  tabId: string
}

/** アクティブ化完了後、本文Viewからその時点のheadingsをTOCサイドバーViewへ送る通知 */
export interface HeadingListUpdatedPayload {
  tabId: string
  headings: Heading[]
  interactive: boolean
}

/** raw/rendered表示切替完了の通知（本文View→main→タブバーView、本文View側が正、FR-007） */
export interface DisplayModeChangedPayload {
  tabId: string
  displayMode: DisplayMode
}

/** タブバーのraw切替ボタンクリックを本文Viewへ転送する要求（タブバーView→main→本文View、FR-007） */
export interface ToggleDisplayModeRequest {
  tabId: string
}

/**
 * タブ切り替え時、検索UI（TOCサイドバーView・フロート検索View）へ通知するペイロード。
 * 検索内容（入力文字列・件数）はタブ単位で保持し、異なるタブへの切り替え時は共有しない
 * （実機フィードバック対応）。`previousTabId`は初回タブ作成時など切り替え元がない場合`null`。
 * `restoredText`はmainプロセスが保持する当該タブの検索文字列（タブ内で一度も検索して
 * いなければ空文字列）で、通知先はこれを入力欄に反映し再検索することで件数も復元する。
 */
export interface SearchClearedPayload {
  previousTabId: string | null
  newTabId: string
  restoredText: string
  /**
   * 通知先View（TOCサイドバー or フロート検索）が、通知時点で「現在アクティブな検索UI」
   * かどうか。TOCサイドバー内検索・フロート検索は排他的にしか使われないため、非アクティブ側
   * でも`findInPage`を実行してしまうと、後から処理された側が`activeSearchView`を奪い
   * 検索結果（件数）が非表示側のUIに届いてしまう不具合が実機で確認された。そのため
   * `restoredText`の入力欄への反映・`currentTabId`の更新は両View共通で行うが、実際の
   * 再検索（`findInPage`呼び出し）はこのフラグが`true`の側のみが行う。
   */
  isActiveView: boolean
}

/** 検索欄入力のたびにmainプロセスへ通知する要求（TOCサイドバーView/フロート検索View→main）。
 * mainプロセスがタブ単位の検索文字列を一元管理する「真実の情報源」となる */
export interface SearchTextChangedRequest {
  tabId: string
  text: string
}

/** TOCサイドバー内検索⇔フロート検索の切替時、切替先へ検索文字列を復元させる通知 */
export interface RestoreSearchTextPayload {
  text: string
}
