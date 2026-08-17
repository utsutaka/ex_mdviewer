import { app, dialog, type BrowserWindow } from 'electron'
import './app-identity'
import {
  applyContentSecurityPolicy,
  closeSplashWindow,
  createMainWindow,
  createSplashWindow,
  getMainWindow
} from './window'
import { getWindowState, wasConfigReset } from './store'
import { handleOpenFile, registerIpcHandlers, setupFoundInPageRelay } from './ipc/handlers'
import { cleanupLegacyFileAssociation } from './file-association'
import { registerAppMenu } from './menu'
import { resolveFileKind } from '@shared/file-kind'

/**
 * コマンドライン引数から対応形式（.md/.json/.yaml/.yml/.xml）のファイルパスを抽出する
 * （002-remove-file-association FR-006、010-json-yaml-xml-viewerで対応形式を拡張）。
 */
function extractSupportedFilePathFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => resolveFileKind(arg) !== null)
}

/**
 * mainプロセスの捕捉されない例外を致命的エラーとして利用者へ通知する（FR-036）。
 * constitution原則Vによりファイルログは残さない。メインウィンドウが存在すればレンダラー側モーダルへ、
 * 存在しなければネイティブダイアログへ通知する（006-splash-screen T013）。
 */
process.on('uncaughtException', (error) => {
  closeSplashWindow()
  const win = getMainWindow()
  if (win) {
    win.webContents.send('fatal-error', error.message)
  } else {
    // メインウィンドウが未生成のため、レンダラー側モーダルの代わりにネイティブダイアログで通知する（Constitution V）
    dialog.showErrorBox('mdviewer', error.message)
  }
})

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  // 二重起動時、既存ウィンドウへファイルパスを転送し新規タブとして開く（FR-010, FR-019）
  app.on('second-instance', (_event, argv) => {
    const filePath = extractSupportedFilePathFromArgv(argv)
    if (filePath) {
      void handleOpenFile(filePath)
    }
  })

  app.whenReady().then(() => {
    const splash = createSplashWindow()
    applyContentSecurityPolicy()
    registerIpcHandlers()
    registerAppMenu()
    void cleanupLegacyFileAssociation()

    // スプラッシュが実際に画面へ表示されてからメインウィンドウの生成を開始する。
    // 並行生成するとメインウィンドウのready-to-showが先に発火する競合が起こり得るため（006-splash-screen FR-001）
    splash.once('ready-to-show', () => {
      let win: BrowserWindow
      try {
        win = createMainWindow(getWindowState())
      } catch (error) {
        closeSplashWindow()
        const message = error instanceof Error ? error.message : String(error)
        dialog.showErrorBox('mdviewer', message)
        app.quit()
        return
      }
      setupFoundInPageRelay(win)

      win.webContents.once('did-finish-load', () => {
        if (wasConfigReset()) {
          win.webContents.send('settings-reset')
        }

        const initialFilePath = extractSupportedFilePathFromArgv(process.argv)
        if (initialFilePath) {
          void handleOpenFile(initialFilePath)
        }
      })
    })
  })

  app.on('window-all-closed', () => {
    // mdviewerはWindows専用の単一ウィンドウ構成のため、常にアプリを終了する
    app.quit()
  })
}
