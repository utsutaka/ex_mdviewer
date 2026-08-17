import { Menu, dialog } from 'electron'
import { dirname } from 'node:path'
import type { OpenFileDialogErrorPayload, SettingsPersistenceErrorPayload } from '@shared/types'
import {
  disablePersistence,
  enablePersistence,
  getAppSettings,
  isPersistenceEnabled,
  setAppSettings
} from './store'
import { getMainWindow } from './window'
import { handleOpenFile } from './ipc/handlers'

/**
 * 「ファイル」メニューの項目（009-native-menu-file-edit FR-002〜FR-005）。
 * ネイティブのファイル選択ダイアログでMarkdownファイルのみを選択候補とし、
 * 選択結果を既存のhandleOpenFile()（ipc/handlers.ts）へそのまま渡す。
 */
function buildFileMenuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'ファイルを開く...(&O)',
      accelerator: 'Ctrl+O',
      click: async () => {
        const win = getMainWindow()
        if (!win) {
          return
        }
        try {
          const result = await dialog.showOpenDialog(win, {
            defaultPath: getAppSettings().lastOpenedDirectory,
            properties: ['openFile'],
            filters: [
              {
                name: '対応ファイル',
                extensions: ['md', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'pdf']
              },
              { name: 'Markdown', extensions: ['md'] },
              { name: 'JSON', extensions: ['json'] },
              { name: 'YAML', extensions: ['yaml', 'yml'] },
              { name: 'XML', extensions: ['xml'] },
              { name: 'HTML', extensions: ['html', 'htm'] },
              { name: 'PDF', extensions: ['pdf'] }
            ]
          })
          if (result.canceled || result.filePaths.length === 0) {
            return
          }
          // 直近フォルダを記憶する（012-remember-last-directory FR-001。「設定を保存する」の
          // ON/OFFに応じた永続化・非永続化はsetAppSettings()側で既存機構がそのまま適用される）
          setAppSettings({ ...getAppSettings(), lastOpenedDirectory: dirname(result.filePaths[0]) })
          void handleOpenFile(result.filePaths[0])
        } catch {
          const payload: OpenFileDialogErrorPayload = {
            message: 'ファイルを開くダイアログの表示に失敗しました'
          }
          win.webContents.send('open-file-dialog-error', payload)
        }
      }
    }
  ]
}

/**
 * 「編集」メニューのダークテーマ・目次を隠す項目（005-native-menu-save-toggle FR-003, 009-native-menu-file-edit FR-006, FR-011, FR-012）。
 * クリック時はrendererへ切替要求を送るのみで、実際のテーマ/TOC表示切替は
 * renderer側で行い、その結果（theme-changed/toc-visibility-changed）を
 * 受けてrefreshAppMenu()がチェック状態を更新する（contracts/ipc-contract-delta.md）。
 */
function buildEditMenuItems(): Electron.MenuItemConstructorOptions[] {
  const settings = getAppSettings()
  return [
    {
      label: 'ダークテーマ',
      type: 'checkbox',
      checked: settings.theme === 'dark',
      click: () => {
        getMainWindow()?.webContents.send('menu-theme-toggle-requested')
      }
    },
    {
      label: '目次を隠す',
      type: 'checkbox',
      checked: !settings.tocVisible,
      click: () => {
        getMainWindow()?.webContents.send('menu-toc-visibility-toggle-requested')
      }
    },
    {
      label: 'ウィンドウ幅に追随',
      type: 'checkbox',
      checked: settings.contentWidthMode === 'full',
      click: () => {
        getMainWindow()?.webContents.send('menu-content-width-toggle-requested')
      }
    }
  ]
}

/**
 * 「設定を保存」チェックボックス項目（005-native-menu-save-toggle FR-004〜FR-009, FR-012, 009-native-menu-file-edit FR-006, FR-010, FR-013）。
 * クリック時の再構築はT015の`refreshAppMenu()`（US2で導入）には依存せず、
 * `registerAppMenu()`を呼び直すことで自己完結させる（US1単体でも動作するため）。
 */
function buildSettingsMenuItem(): Electron.MenuItemConstructorOptions {
  return {
    label: '設定を保存',
    type: 'checkbox',
    checked: isPersistenceEnabled(),
    click: () => {
      const shouldEnable = !isPersistenceEnabled()
      const succeeded = shouldEnable ? enablePersistence() : disablePersistence()
      if (!succeeded) {
        const payload: SettingsPersistenceErrorPayload = {
          message: shouldEnable
            ? '設定の保存を有効にできませんでした'
            : '設定の保存を無効にできませんでした'
        }
        getMainWindow()?.webContents.send('settings-persistence-error', payload)
      }
      registerAppMenu()
    }
  }
}

/** ネイティブメニューのテンプレートを構築する（005-native-menu-save-toggle FR-002, 009-native-menu-file-edit FR-001, FR-006）。 */
function buildMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'ファイル(&F)',
      submenu: buildFileMenuItems()
    },
    {
      label: '編集(&E)',
      submenu: [...buildEditMenuItems(), buildSettingsMenuItem()]
    }
  ]
}

/** ネイティブメニューを構築し、アプリケーションメニューとして登録する */
export function registerAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()))
}

/**
 * `getAppSettings()`の現在値からメニュー項目のラベルを更新し再設定する。
 * `buildMenuTemplate()`は毎回現在値を読み直すため、再構築するだけでよい。
 */
export function refreshAppMenu(): void {
  registerAppMenu()
}
