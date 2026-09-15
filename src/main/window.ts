import { BrowserWindow, WebContentsView, dialog, screen, session } from 'electron'
import { join } from 'node:path'
import type { WindowState } from '@shared/types'
import type { FileKind } from '@shared/file-kind'
import { isTocSupported } from '@shared/file-kind'
import { attachExternalLinkGuard } from './external-link-guard'
import { getAppSettings, updateWindowState } from './store'

/**
 * constitution原則II: CSPにより外部通信を全面禁止する。
 * 'self'すら許可せず、file://で読み込まれるローカルリソースのみを許容する。
 * frame-srcのfile:、style-src/script-src/img-src/font-srcのchrome://resourcesは
 * PDF表示（Chromium内蔵PDFビューア）のために必要な許可（011-html-pdf-viewer FR-005〜FR-006）。
 * いずれも外部ネットワーク通信を伴わないローカル/内部プロトコル限定の許可であり、
 * chrome://resourcesは完全一致に限定しワイルドカードは使用しない（research.md Decision 2）。
 * frame-srcのhttp: https:は、036-iframe-html-view（HTML表示のiframe化）でHTML内の
 * httpsリンククリックをwill-frame-navigateイベントで検知するために追加した許可。
 * ナビゲーション遷移自体は即座にevent.preventDefault()でブロックされ、外部ブラウザでの
 * 閲覧は既存の確認ダイアログ経由でshell.openExternalへ委譲する構成（008-fix-external-link-nav）
 * を維持するため、mdviewer自体が外部通信を行うことにはならない（036 research.md Decision 2）。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' chrome://resources",
  "style-src 'self' 'unsafe-inline' chrome://resources",
  "img-src 'self' data: chrome://resources",
  "font-src 'self' data: chrome://resources",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'self' file: http: https:"
].join('; ')

export function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    })
  })
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getSplashWindow(): BrowserWindow | null {
  return splashWindow
}

/**
 * 033-webcontentsview-search-fix: UIと本文を4つのWebContentsView（タブバーView・
 * TOCサイドバーView・フロート検索View・本文View）に分離する（research.md Decision 1a）。
 * `webContents.findInPage`がページ全体を検索対象にするというElectronの仕様上の制約を、
 * 対象を本文ViewのwebContentsのみに絞ることで回避する（FR-002）。
 * 既存レイアウト（タブバー上部・TOCサイドバー左・検索バーが本文に重ねて浮く）はL字型＋
 * オーバーレイであり、矩形boundsでしか配置できないWebContentsViewでは単純な2分割では
 * 表現できないため、矩形ごとに分割する（透過合成2View構成はマウスイベント制御が
 * 困難なため不採用、research.md Decision 1a）。
 */
let tabBarView: WebContentsView | null = null
let sidebarTocView: WebContentsView | null = null
let sidebarExplorerView: WebContentsView | null = null
let searchFloatView: WebContentsView | null = null
let contentView: WebContentsView | null = null
/**
 * フロート検索Viewの表示状態（`setVisible`の値そのものを保持）。
 * `searchInUse`（FocusLockState、フォーカスの有無）とは別の状態であり、タブ切り替え等で
 * フロート検索の入力欄がフォーカスを失っても（`searchInUse`がfalseになっても）、
 * View自体は表示されたままになりうる。TOC表示/非表示に連動したフロート検索の
 * 自動開閉判定（handlers.ts `syncSearchUiWithTocVisibility`・`migrateTocSearchToFloatOnHide`）
 * はこちらを参照する必要があるため、フォーカス状態と混同しないよう別変数として管理する
 * （実機フィードバック対応）。
 */
let searchFloatVisible = false

/**
 * 現在アクティブなタブのファイル種別（034-toc-filekind-scope data-model.md「ランタイム状態」）。
 * `relayoutViews`のTOC幅計算でのみ参照する。タブが1件も開かれていない場合は`null`。
 * mainプロセス側の依存方向（ipc/handlers.ts → window.ts）を維持するため、タブ管理状態
 * （`openTabs`・`currentActiveTabId`、ipc/handlers.ts）とは二重管理せず、アクティブタブ切替の
 * 起点となる箇所（handlers.ts）からこのsetterを呼んでもらう方式にする（research.md Decision 2）。
 */
let activeTabFileKind: FileKind | null = null

/**
 * アクティブタブに見出しが1件以上存在するか（003-toc-toggle FR-004の「見出しなし文書は
 * トグル状態に関わらずTOCサイドバーを表示してはならない」を、034-toc-filekind-scope以降の
 * View分割アーキテクチャでも幅0として正しく反映するために保持する）。
 * アクティブタブ切替の起点（`setActiveTabFileKind`）で一旦trueへリセットし、本文View側から
 * 実際の見出しリストが届いた時点（`heading-list-updated`、ipc/handlers.ts）で確定する。
 * 見出し情報が届く前の短い間だけ実際より広めにTOC幅を確保してしまう可能性はあるが、
 * 逆に見出しありのタブへ切り替えた直後にfalseのまま誤って幅0にしてしまう方が実害が大きいため、
 * 安全側のtrueを初期値・リセット値とする。
 */
let activeTabHasHeadings = true

/** アクティブタブのファイル種別を更新する（034-toc-filekind-scope、呼び出し後は`relayoutViews`の再実行が必要） */
export function setActiveTabFileKind(fileKind: FileKind | null): void {
  activeTabFileKind = fileKind
  activeTabHasHeadings = true
}

/**
 * アクティブタブの見出し有無を更新する（`heading-list-updated`受信時、呼び出し後は
 * `relayoutViews`の再実行が必要）。
 */
export function setActiveTabHasHeadings(hasHeadings: boolean): void {
  activeTabHasHeadings = hasHeadings
}

/**
 * アクティブタブのファイル種別を取得する（036-iframe-html-view）。
 * `zoom-changed`イベント経由のCtrl+ホイールズーム中継が、HTML表示タブ（iframe）でのみ
 * 発火するように判定する用途で使う（Markdown等はrenderer側の既存wheelイベント
 * リスナーが機能するため、二重処理を避ける必要がある）。
 */
export function getActiveTabFileKind(): FileKind | null {
  return activeTabFileKind
}

export function getTabBarView(): WebContentsView | null {
  return tabBarView
}

export function getSidebarTocView(): WebContentsView | null {
  return sidebarTocView
}

/** エクスプローラーサイドバーViewを取得する（038-explorer-sidebar） */
export function getSidebarExplorerView(): WebContentsView | null {
  return sidebarExplorerView
}

export function getSearchFloatView(): WebContentsView | null {
  return searchFloatView
}

/** フロート検索Viewが現在表示されているか（`searchInUse`＝フォーカス有無とは独立、実機フィードバック対応） */
export function isSearchFloatVisible(): boolean {
  return searchFloatVisible
}

export function getContentView(): WebContentsView | null {
  return contentView
}

/** タブバーの高さ（`base.css`の`.tab-bar-wrapper`と一致させる、FR-006） */
const TAB_BAR_HEIGHT = 36

/**
 * フロート検索Viewの既定サイズ（本文View右上に重ねて配置、FR-006）。
 * 入力欄・件数表示・移動ボタン（▲▼）・閉じるボタンを横一列に収める必要があるため、
 * 360pxでは閉じるボタンの幅がほぼ確保できず折り返される不具合が実機で確認された。
 */
const SEARCH_FLOAT_WIDTH = 460
const SEARCH_FLOAT_HEIGHT = 44
const SEARCH_FLOAT_MARGIN = 12

/**
 * TOCサイドバーが実際に表示されているか（034-toc-filekind-scope）。
 * `settings.tocVisible`（利用者設定）と、現在アクティブなタブのfileKindがTOC対応かどうかの
 * 両方を考慮する。設定がONでも非対応fileKind（PDF・JSON・YAML・XML）の場合はfalseを返す。
 * Ctrl+F押下時にTOC内検索・フロート検索のどちらを開くか（ipc/handlers.ts）等、
 * 「サイドバーが実際に画面上に見えているか」を必要とする箇所で`settings.tocVisible`単独の
 * 判定を使うと、非対応fileKind表示中にTOC内検索（実際には幅0で不可視）へフォーカスしようと
 * してしまい、Ctrl+Fが見かけ上機能しなくなる不具合につながるため、この関数を必ず使用する。
 */
export function isTocSidebarVisible(): boolean {
  const settings = getAppSettings()
  return settings.tocVisible && isActiveTabTocSupportedFileKind() && activeTabHasHeadings
}

/**
 * tocVisible設定を考慮せず、現在アクティブなタブのfileKindだけでTOC対応可否を判定する
 * （034-toc-filekind-scope）。`toc-visibility-changed`ハンドラでtocVisible設定を更新した
 * 直後に「変更前は実際にTOCが表示されていたか」を判定する場合など、`isTocSidebarVisible()`
 * では設定変更後の値しか取れず判定できないケースのために公開する。
 */
export function isActiveTabTocSupportedFileKind(): boolean {
  return activeTabFileKind !== null && isTocSupported(activeTabFileKind)
}

/** `relayoutViews`のオプション引数（038-explorer-sidebar research.md Decision 6） */
export interface RelayoutOptions {
  /**
   * エクスプローラーバーのドラッグ中プレビュー用の一時的な幅。指定時は`AppSettings.explorerWidth`
   * を無視してこの値を使う（`AppSettings`自体は変更しない、永続化はしない）。
   */
  explorerWidthOverride?: number
  /**
   * TOCサイドバーのドラッグ中プレビュー用の一時的な幅。指定時は`AppSettings.tocWidth`を
   * 無視してこの値を使う（`AppSettings`自体は変更しない、永続化はしない）。
   * 038-explorer-sidebar実機フィードバック対応: 従来TOCの幅変更は`pointerup`（ドラッグ確定時）
   * にしか`relayoutViews`を呼んでいなかったため、View自体のboundsはドラッグ中固定のままで、
   * renderer側でCSS変数`--toc-width`のみを書き換えていた。本番ビルドではVEが
   * `<style>`タグをCSS読み込み順序の先頭へ並べ替えるため、`base.css`側の
   * `.sidebar-toc { flex: 0 0 var(--toc-width, 220px) }`が本番ビルド限定でこのCSS変数の
   * 変更に反応してしまい、View bounds（実際の画面上ピクセル幅）とは無関係にパネル内部の
   * flex-basisだけが変化し、空白や表示崩れが生じていた（fb3bb88と同型のCSS読み込み順序
   * 不具合クラス、research.md Decision 9）。エクスプローラーバーと同じ「ドラッグ中は
   * プレビューIPCでView boundsそのものを都度更新し、確定時のみ永続化する」二段階方式へ
   * 統一し、`.sidebar-toc`側のflex-basis指定自体も削除した。
   */
  tocWidthOverride?: number
}

/**
 * ウィンドウ全体・エクスプローラー幅・TOC幅・各表示状態・フロート検索の開閉状態から
 * 5Viewのboundsを一元的に算出し適用する（data-model.md ViewBounds）。ウィンドウの
 * resizeイベント、エクスプローラー/TOC幅・表示状態の変更、フロート検索の開閉のいずれ
 * からも呼び出される単一の関数とすることで、レイアウト計算ロジックが分散しないように
 * する（research.md Decision 1a「実装上の留意点」）。
 *
 * 038-explorer-sidebar: エクスプローラー(左)→本文→目次(右)の3ペイン構成に変更した
 * （research.md Decision 1）。エクスプローラーバーの表示可否は目次バーと異なり
 * fileKindによる制限を受けない（`settings.explorerVisible`のみで決まる、spec.md FR-001）。
 */
/**
 * `setBounds`に渡す幅が数値として不正（`undefined`・`NaN`・非有限値）な場合に既定値へ
 * フォールバックする（038-explorer-sidebar実機検証で判明: `WebContentsView.setBounds`に
 * 不正な幅を渡すとmainプロセスが例外を投げてアプリ全体が落ちる。永続化された設定値が
 * 何らかの理由で欠落・破損していても、レイアウト計算の最終防衛線としてここで必ず
 * 有限の整数に補正する）。
 */
function sanitizeWidth(width: number | undefined, fallback: number): number {
  return Number.isFinite(width) ? (width as number) : fallback
}

export function relayoutViews(win: BrowserWindow, options?: RelayoutOptions): void {
  if (!tabBarView || !sidebarTocView || !sidebarExplorerView || !contentView) {
    return
  }
  const bounds = win.contentView.getBounds()
  const { width, height } = bounds
  const settings = getAppSettings()
  const explorerWidth = settings.explorerVisible
    ? sanitizeWidth(options?.explorerWidthOverride ?? settings.explorerWidth, 240)
    : 0
  // 034-toc-filekind-scope FR-001, FR-002, FR-007: アクティブタブがMarkdown・HTML以外
  // （PDF・JSON・YAML・XML、またはタブなし）の場合、tocVisibleの値に関わらずTOC幅を0にする。
  // settings.tocWidth自体は変更しないため、対応種別のタブへ戻れば従来の幅で復元される。
  const tocWidth = isTocSidebarVisible() ? sanitizeWidth(options?.tocWidthOverride ?? settings.tocWidth, 220) : 0
  const contentHeight = Math.max(0, height - TAB_BAR_HEIGHT)
  const contentWidth = Math.max(0, width - explorerWidth - tocWidth)

  tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
  sidebarExplorerView.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width: explorerWidth, height: contentHeight })
  contentView.setBounds({ x: explorerWidth, y: TAB_BAR_HEIGHT, width: contentWidth, height: contentHeight })
  sidebarTocView.setBounds({ x: explorerWidth + contentWidth, y: TAB_BAR_HEIGHT, width: tocWidth, height: contentHeight })

  if (searchFloatView) {
    const floatX = explorerWidth + Math.max(0, contentWidth - SEARCH_FLOAT_WIDTH - SEARCH_FLOAT_MARGIN)
    searchFloatView.setBounds({
      x: floatX,
      y: TAB_BAR_HEIGHT + SEARCH_FLOAT_MARGIN,
      width: Math.min(SEARCH_FLOAT_WIDTH, contentWidth),
      height: SEARCH_FLOAT_HEIGHT
    })
  }
}

function createViewPreferences(preloadFileName: string): Electron.WebPreferences {
  return {
    preload: join(__dirname, `../preload/${preloadFileName}`),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
}

function loadViewContent(view: WebContentsView, htmlDirName: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    // electron-viteのrendererはrootを`src/renderer`に設定しているため、
    // devサーバーURLからの相対パスは`src/renderer`を含まない
    void view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${htmlDirName}/index.html`)
  } else {
    void view.webContents.loadFile(join(__dirname, `../renderer/${htmlDirName}/index.html`))
  }
}

/**
 * フロート検索Viewはウィンドウ生成時に一度だけ生成し、以降は`setVisible`で
 * 表示/非表示のみを切り替える（破棄・再生成しない）。実機フィードバックにより、
 * 開くたびに新規Viewを生成・ロードする方式（research.md Decision 1a当初案）は
 * 表示までの体感速度が遅く、`setVisible`方式へ変更した。HTML/JSのロードコストは
 * ウィンドウ生成時の1回のみで、以降のメモリ増加は生成済みView1つ分に留まる。
 */
function createSearchFloatView(win: BrowserWindow): WebContentsView {
  const view = new WebContentsView({ webPreferences: createViewPreferences('search-float-preload.js') })
  // Viewの矩形（460x44）とカード状の#search-bar本体の実サイズが一致しないため、
  // 背景を透過にしてView自体の余白が目立たないようにする（本文が透けて見える）
  view.setBackgroundColor('#00000000')
  win.contentView.addChildView(view)
  loadViewContent(view, 'search-float')
  view.setVisible(false)
  return view
}

export function openSearchFloatView(win: BrowserWindow): WebContentsView {
  if (!searchFloatView) {
    searchFloatView = createSearchFloatView(win)
  }
  searchFloatView.setVisible(true)
  searchFloatVisible = true
  relayoutViews(win)
  // renderer側のinputEl.focus()はDOM上のフォーカスに過ぎず、OSレベルでこのView自体が
  // キーボードフォーカスを持っていないと実際の入力は届かないため、明示的に focus() する
  searchFloatView.webContents.focus()
  // 033-webcontentsview-search-fix: Viewは常時存在し`init()`はロード時の1回しか
  // 実行されないため、開くたびにDOM側のフォーカス処理（inputEl.focus()等）を
  // 再実行させる通知が必要
  searchFloatView.webContents.send('search-float-shown')
  return searchFloatView
}

/** フロート検索Viewを非表示にする（破棄はしない、`setVisible`方式）。開いていない場合は何もしない */
export function closeSearchFloatView(): void {
  searchFloatView?.setVisible(false)
  searchFloatVisible = false
}

/**
 * 起動直後の空白時間を埋めるスプラッシュウィンドウを生成する（006-splash-screen FR-001, FR-003〜FR-006）。
 * `center: true`によりプライマリディスプレイ中央に配置される（マルチモニタ環境でも一貫した挙動）。
 */
export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/splash.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/splash.html'))
  }

  splashWindow = win
  win.on('closed', () => {
    splashWindow = null
  })

  return win
}

/** スプラッシュウィンドウが存在すれば閉じる。正常系・異常系いずれからも安全に呼べる（FR-002, FR-008） */
export function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
  }
}

/** 最小化・背面のウィンドウを復元・最前面表示する（FR-019） */
export function restoreAndFocusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore()
  }
  win.focus()
}

/**
 * 記憶した座標がいずれのディスプレイの表示範囲にも含まれない場合、
 * プライマリディスプレイの中央へフォールバック配置する（FR-028）。
 */
function resolveBounds(initialState: WindowState): {
  x: number | undefined
  y: number | undefined
  width: number
  height: number
} {
  const { width, height } = initialState

  if (initialState.x < 0 || initialState.y < 0) {
    return { x: undefined, y: undefined, width, height }
  }

  const fitsAnyDisplay = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      initialState.x >= area.x &&
      initialState.y >= area.y &&
      initialState.x + width <= area.x + area.width &&
      initialState.y + height <= area.y + area.height
    )
  })

  if (fitsAnyDisplay) {
    return { x: initialState.x, y: initialState.y, width, height }
  }

  const primary = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height
  }
}

/**
 * ウィンドウのリサイズ・移動・最大化/最大化解除時に境界情報を永続化する（FR-007）。
 * minimizeイベントでは更新しない（最小化状態自体は永続化しない、T038）。
 */
function attachBoundsPersistence(win: BrowserWindow): void {
  const persistBounds = (): void => {
    if (win.isMinimized()) {
      return
    }
    const isMaximized = win.isMaximized()
    const bounds = win.getBounds()
    updateWindowState({
      isMaximized,
      ...(isMaximized ? {} : { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y })
    })
  }

  win.on('resize', persistBounds)
  win.on('move', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
}

/**
 * PDFビューアの「再読み込み」ボタン等、意図しない経路でトップレベルフレーム（rendererの
 * index.html）が再読み込みされることを防ぐ（011-html-pdf-viewer、実機確認で発見した不具合）。
 * Chromium内蔵PDFビューアの「再読み込み」ボタンをクリックすると、iframe内部だけでなく
 * mainWindowのトップレベルページ自体が再ナビゲートされ、renderer側の状態（開いているタブ等）が
 * すべて失われる現象を実機確認した。この再ナビゲーションはwill-navigate/will-frame-navigate
 * いずれのイベントでも検知・ブロックできない経路だったため、より低レイヤーの
 * webRequest.onBeforeRequestでブロックする。mdviewerは起動後にmainWindowのトップレベルページを
 * 意図的にリロードする設計を持たないため、初回ロードのみ許可し以降のmainFrameへのロードは
 * すべてブロックする。
 */
/**
 * 033-webcontentsview-search-fix: 4View分離に伴い、PDFを実際に表示する本文Viewの
 * webContentsのみを対象にする（分離前は単一webContentsだった`win.webContents`の代わり）。
 */
function preventUnintendedMainFrameReload(_win: BrowserWindow, targetWebContents: Electron.WebContents): void {
  let guardEnabled = false
  // 初回ロードが完全に完了するまでガードを無効化する。初回ロード中に発生しうる
  // 複数リクエスト（内部的なリダイレクト等を含む可能性がある）をすべて許可したうえで、
  // did-finish-load以降のmainFrameへの再ロードのみを対象にブロックする
  targetWebContents.once('did-finish-load', () => {
    guardEnabled = true
  })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (guardEnabled && details.resourceType === 'mainFrame' && details.webContentsId === targetWebContents.id) {
      callback({ cancel: true })
      return
    }
    callback({})
  })
}

/**
 * WindowStateを復元してメインウィンドウを生成する（FR-007）。
 * x/yが未記録（初回起動、値-1）の場合はElectronの既定配置に委ねる。
 */
export function createMainWindow(initialState: WindowState): BrowserWindow {
  const bounds = resolveBounds(initialState)

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // 5つのWebContentsView（タブバーView・エクスプローラーサイドバーView・TOCサイドバーView・
  // 本文View・フロート検索View）を生成する。フロート検索Viewは非表示状態で事前生成しておき、
  // 開くたびの新規生成による体感遅延を避ける（実機フィードバック対応、`createSearchFloatView`参照）
  tabBarView = new WebContentsView({ webPreferences: createViewPreferences('tab-bar-preload.js') })
  sidebarExplorerView = new WebContentsView({ webPreferences: createViewPreferences('sidebar-explorer-preload.js') })
  sidebarTocView = new WebContentsView({ webPreferences: createViewPreferences('sidebar-toc-preload.js') })
  contentView = new WebContentsView({
    webPreferences: {
      ...createViewPreferences('content-preload.js'),
      // Chromium内蔵PDFビューアプラグインを有効化する（011-html-pdf-viewer FR-005）
      plugins: true
    }
  })

  win.contentView.addChildView(tabBarView)
  win.contentView.addChildView(sidebarExplorerView)
  win.contentView.addChildView(sidebarTocView)
  win.contentView.addChildView(contentView)

  loadViewContent(tabBarView, 'tab-bar')
  loadViewContent(sidebarExplorerView, 'sidebar-explorer')
  loadViewContent(sidebarTocView, 'sidebar-toc')
  loadViewContent(contentView, 'content')

  searchFloatView = createSearchFloatView(win)

  relayoutViews(win)
  win.on('resize', () => relayoutViews(win))

  // 033-webcontentsview-search-fix: トップレベルのwin自体には何もロードしないため、
  // `ready-to-show`（通常はロード完了後に発火）は発火しない。代わりに4つのViewすべての
  // 初回読み込み完了を待ってから表示する。
  Promise.all(
    [tabBarView, sidebarExplorerView, sidebarTocView, contentView].map(
      (view) =>
        new Promise<void>((resolvePromise) => {
          view.webContents.once('did-finish-load', () => resolvePromise())
        })
    )
  ).then(() => {
    if (initialState.isMaximized) {
      win.maximize()
    }
    win.show()
    closeSplashWindow()
  })

  // PDFビューアの「再読み込み」ボタン等による意図しない再ナビゲーションを防ぐガードは、
  // PDFを実際に表示する本文ViewのwebContentsに対して適用する（4View化前は単一webContents
  // だったため`win.webContents`に対して適用していた）
  preventUnintendedMainFrameReload(win, contentView.webContents)

  attachBoundsPersistence(win)
  attachExternalLinkGuard(win, contentView.webContents)

  mainWindow = win
  win.on('closed', () => {
    tabBarView = null
    sidebarExplorerView = null
    sidebarTocView = null
    searchFloatView = null
    contentView = null
    mainWindow = null
  })

  return win
}

/**
 * タブの×ボタン経由（開いているタブが1つだけ）の確認ダイアログを表示し、
 * 利用者が「はい」（アプリも終了する）を選択したかを返す（022-quit-dialog-close-tab FR-001）。
 * 既存のexternal-link-guard.tsのopenExternalWithConfirmationと同型のdialog.showMessageBoxパターンを再利用する。
 * defaultId・cancelIdをともに「いいえ」に設定し、既定選択・Escキー・ダイアログの×ボタンいずれも
 * 同じ結果になる対称構成とする（FR-004、research.md Decision 1）。
 */
export async function confirmCloseLastTab(win: BrowserWindow): Promise<boolean> {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'mdviewer',
    buttons: ['はい', 'いいえ'],
    defaultId: 1,
    cancelId: 1,
    message: 'アプリも終了しますか？'
  })
  return result.response === 0
}

/**
 * タブの×ボタン経由で「はい」が選ばれ、これからwin.close()を呼ぶことを記録する
 * （022-quit-dialog-close-tab research.md Decision 2）。attachQuitConfirmationのcloseイベント側で
 * 二重確認を回避するために参照される。単一ウィンドウ構成（Constitution原則I）のため、
 * モジュールレベルの状態として保持する（既存のmainWindow・splashWindowと同様のパターン）。
 */
let quitAlreadyHandled = false

export function markQuitHandled(): void {
  quitAlreadyHandled = true
}

/**
 * OS標準のウィンドウ閉じる操作（タイトルバー×・Alt+F4等）経由の確認ダイアログを表示し、
 * 利用者が「はい」を選択したかを返す（022-quit-dialog-close-tab FR-006）。タブについて一切言及しない。
 * defaultId（Enterキー用、「はい」）とcancelId（Esc・ダイアログの×ボタン用、「いいえ」）を
 * 意図的に異なる値に設定する非対称構成（FR-009、research.md Decision 1）。
 */
async function confirmQuitFromWindowClose(win: BrowserWindow): Promise<boolean> {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'mdviewer',
    buttons: ['いいえ', 'はい'],
    defaultId: 1,
    cancelId: 0,
    message: 'アプリを終了しますか？'
  })
  return result.response === 1
}

/**
 * BrowserWindowのcloseイベントを唯一の終了ゲートとする（022-quit-dialog-close-tab FR-006）。
 * markQuitHandled()済みの場合は素通りし、それ以外は開いているタブの数によらず常に
 * confirmQuitFromWindowCloseを介する（research.md Decision 2）。「はい」が選ばれた場合、
 * closeAllTabsで開いているタブを一括クリーンアップしてからwin.close()する。
 * closeAllTabsは呼び出し元が注入する（window.tsはタブの概念を持たない、research.md Decision 4）。
 */
export function attachQuitConfirmation(win: BrowserWindow, closeAllTabs: () => void): void {
  win.on('close', (event) => {
    if (quitAlreadyHandled) {
      return
    }
    event.preventDefault()
    void (async () => {
      const confirmed = await confirmQuitFromWindowClose(win)
      if (confirmed) {
        quitAlreadyHandled = true
        closeAllTabs()
        win.close()
      }
    })()
  })
}
