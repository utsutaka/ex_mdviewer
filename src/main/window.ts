import { BrowserWindow, WebContentsView, dialog, screen, session } from 'electron'
import { join } from 'node:path'
import type { WindowState } from '@shared/types'
import { attachExternalLinkGuard } from './external-link-guard'
import { getAppSettings, updateWindowState } from './store'

/**
 * constitution原則II: CSPにより外部通信を全面禁止する。
 * 'self'すら許可せず、file://で読み込まれるローカルリソースのみを許容する。
 * frame-srcのfile:、style-src/script-src/img-src/font-srcのchrome://resourcesは
 * PDF表示（Chromium内蔵PDFビューア）のために必要な許可（011-html-pdf-viewer FR-005〜FR-006）。
 * いずれも外部ネットワーク通信を伴わないローカル/内部プロトコル限定の許可であり、
 * chrome://resourcesは完全一致に限定しワイルドカードは使用しない（research.md Decision 2）。
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
  "frame-src 'self' file:"
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
let searchFloatView: WebContentsView | null = null
let contentView: WebContentsView | null = null
/**
 * フロート検索Viewの表示状態（`setVisible`の値そのものを保持）。
 * `searchInUse`（FocusLockState、フォーカスの有無）とは別の状態であり、タブ切り替え等で
 * フロート検索の入力欄がフォーカスを失っても（`searchInUse`がfalseになっても）、
 * View自体は表示されたままになりうる。TOC表示/非表示に連動したフロート検索の
 * 自動開閉判定（handlers.ts `handleTocVisibilityChangeForSearch`）はこちらを参照する
 * 必要があるため、フォーカス状態と混同しないよう別変数として管理する（実機フィードバック対応）。
 */
let searchFloatVisible = false

export function getTabBarView(): WebContentsView | null {
  return tabBarView
}

export function getSidebarTocView(): WebContentsView | null {
  return sidebarTocView
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
 * ウィンドウ全体・TOC幅・TOC表示状態・フロート検索の開閉状態から4Viewのboundsを
 * 一元的に算出し適用する（data-model.md ViewBounds）。ウィンドウのresizeイベント、
 * TOC幅・表示状態の変更、フロート検索の開閉のいずれからも呼び出される単一の関数とする
 * ことで、レイアウト計算ロジックが分散しないようにする（research.md Decision 1a
 * 「実装上の留意点」）。
 */
export function relayoutViews(win: BrowserWindow): void {
  if (!tabBarView || !sidebarTocView || !contentView) {
    return
  }
  const bounds = win.contentView.getBounds()
  const { width, height } = bounds
  const settings = getAppSettings()
  const tocWidth = settings.tocVisible ? settings.tocWidth : 0
  const contentHeight = Math.max(0, height - TAB_BAR_HEIGHT)
  const contentWidth = Math.max(0, width - tocWidth)

  tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT })
  sidebarTocView.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width: tocWidth, height: contentHeight })
  contentView.setBounds({ x: tocWidth, y: TAB_BAR_HEIGHT, width: contentWidth, height: contentHeight })

  if (searchFloatView) {
    const floatX = tocWidth + Math.max(0, contentWidth - SEARCH_FLOAT_WIDTH - SEARCH_FLOAT_MARGIN)
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

  // 4つのWebContentsView（タブバーView・TOCサイドバーView・本文View・フロート検索View）
  // を生成する。フロート検索Viewは非表示状態で事前生成しておき、開くたびの新規生成による
  // 体感遅延を避ける（実機フィードバック対応、`createSearchFloatView`参照）
  tabBarView = new WebContentsView({ webPreferences: createViewPreferences('tab-bar-preload.js') })
  sidebarTocView = new WebContentsView({ webPreferences: createViewPreferences('sidebar-toc-preload.js') })
  contentView = new WebContentsView({
    webPreferences: {
      ...createViewPreferences('content-preload.js'),
      // Chromium内蔵PDFビューアプラグインを有効化する（011-html-pdf-viewer FR-005）
      plugins: true
    }
  })

  win.contentView.addChildView(tabBarView)
  win.contentView.addChildView(sidebarTocView)
  win.contentView.addChildView(contentView)

  loadViewContent(tabBarView, 'tab-bar')
  loadViewContent(sidebarTocView, 'sidebar-toc')
  loadViewContent(contentView, 'content')

  searchFloatView = createSearchFloatView(win)

  relayoutViews(win)
  win.on('resize', () => relayoutViews(win))

  // 033-webcontentsview-search-fix: トップレベルのwin自体には何もロードしないため、
  // `ready-to-show`（通常はロード完了後に発火）は発火しない。代わりに3つのViewすべての
  // 初回読み込み完了を待ってから表示する。
  Promise.all(
    [tabBarView, sidebarTocView, contentView].map(
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
