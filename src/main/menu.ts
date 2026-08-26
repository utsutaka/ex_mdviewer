import { Menu, dialog } from 'electron'
import type { OpenFileDialogErrorPayload, SettingsPersistenceErrorPayload } from '@shared/types'
import { disablePersistence, enablePersistence, getAppSettings, isPersistenceEnabled } from './store'
import { getMainWindow } from './window'
import { handleOpenFile } from './ipc/handlers'
import { appVersion } from './app-version'

/**
 * 「ファイルを開く...」ダイアログを表示する共通処理（031-folder-history-menu research.md
 * Decision 4）。通常の「ファイルを開く...」項目・フォルダ履歴の各項目のいずれからも、
 * `defaultPath`だけを変えて呼び出される。フォルダ履歴への記録自体はここでは行わず、
 * 実際にファイルが選択され`handleOpenFile()`が呼ばれた時点で行われる（research.md Decision 5）。
 */
async function openFileDialogAt(defaultPath?: string): Promise<void> {
  const win = getMainWindow()
  if (!win) {
    return
  }
  try {
    const result = await dialog.showOpenDialog(win, {
      defaultPath,
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
    void handleOpenFile(result.filePaths[0])
  } catch {
    const payload: OpenFileDialogErrorPayload = {
      message: 'ファイルを開くダイアログの表示に失敗しました'
    }
    win.webContents.send('open-file-dialog-error', payload)
  }
}

/**
 * 「フォルダ履歴のつづき」submenu内の項目を含む、フォルダ履歴1件分のメニュー項目を生成する
 * （031-folder-history-menu FR-005, FR-006, FR-008）。ラベルはフォルダの絶対パスをそのまま
 * 表示し、アクセスキーは割り当てない（research.md Decision 7）。
 */
function buildFolderHistoryItem(folder: string): Electron.MenuItemConstructorOptions {
  return {
    label: folder,
    click: () => {
      void openFileDialogAt(folder)
    }
  }
}

/**
 * 「ファイル」メニューの項目（009-native-menu-file-edit FR-002〜FR-005、
 * 031-folder-history-menu FR-004〜FR-008, FR-013）。
 * ネイティブのファイル選択ダイアログでMarkdownファイルのみを選択候補とし、
 * 選択結果を既存のhandleOpenFile()（ipc/handlers.ts）へそのまま渡す。
 * フォルダ履歴が1件以上ある場合、区切り線に続けて上位3件を直接項目として表示し、
 * 4件目以降（最大7件）は「フォルダ履歴のつづき」submenuにまとめる。
 */
function buildFileMenuItems(): Electron.MenuItemConstructorOptions[] {
  const folderHistory = getAppSettings().folderHistory
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'ファイルを開く...(&O)',
      accelerator: 'Ctrl+O',
      click: () => {
        void openFileDialogAt(folderHistory[0])
      }
    }
  ]

  if (folderHistory.length === 0) {
    return items
  }

  items.push({ type: 'separator' }, ...folderHistory.slice(0, 3).map(buildFolderHistoryItem))

  const rest = folderHistory.slice(3, 10)
  if (rest.length > 0) {
    items.push({
      label: 'フォルダ履歴のつづき(&C)',
      submenu: rest.map(buildFolderHistoryItem)
    })
  }

  return items
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

/**
 * 「ヘルプ」メニューの項目（028-version-info-menu FR-001, FR-002）。
 * 「バージョン情報」クリック時、ビルド時に確定した`appVersion`（gitのコミット履歴
 * が利用可能ならHEADコミット日時、利用不可なら非公式マーカー付きのビルド実行時刻。
 * FR-005, FR-007）をネイティブダイアログで表示する（research.md Decision 5）。
 */
function buildHelpMenuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'バージョン情報',
      click: () => {
        const win = getMainWindow()
        if (!win) {
          return
        }
        void dialog.showMessageBox(win, {
          type: 'info',
          buttons: ['OK'],
          title: 'mdviewer',
          message: 'mdviewer',
          detail: `バージョン: ${appVersion}`
        })
      }
    }
  ]
}

/** ネイティブメニューのテンプレートを構築する（005-native-menu-save-toggle FR-002, 009-native-menu-file-edit FR-001, FR-006, 028-version-info-menu FR-001）。 */
function buildMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'ファイル(&F)',
      submenu: buildFileMenuItems()
    },
    {
      label: '編集(&E)',
      submenu: [...buildEditMenuItems(), buildSettingsMenuItem()]
    },
    {
      label: 'ヘルプ(&H)',
      submenu: buildHelpMenuItems()
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
