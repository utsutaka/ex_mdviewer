import { BrowserWindow, screen, session } from 'electron'
import { join } from 'node:path'
import type { WindowState } from '@shared/types'
import { attachExternalLinkGuard } from './external-link-guard'
import { updateWindowState } from './store'

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
function preventUnintendedMainFrameReload(win: BrowserWindow): void {
  let guardEnabled = false
  // 初回ロードが完全に完了するまでガードを無効化する。初回ロード中に発生しうる
  // 複数リクエスト（内部的なリダイレクト等を含む可能性がある）をすべて許可したうえで、
  // did-finish-load以降のmainFrameへの再ロードのみを対象にブロックする
  win.webContents.once('did-finish-load', () => {
    guardEnabled = true
  })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (guardEnabled && details.resourceType === 'mainFrame' && details.webContentsId === win.webContents.id) {
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
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium内蔵PDFビューアプラグインを有効化する（011-html-pdf-viewer FR-005）
      plugins: true
    }
  })

  win.once('ready-to-show', () => {
    if (initialState.isMaximized) {
      win.maximize()
    }
    win.show()
    closeSplashWindow()
  })

  preventUnintendedMainFrameReload(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  attachBoundsPersistence(win)
  attachExternalLinkGuard(win)

  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })

  return win
}
