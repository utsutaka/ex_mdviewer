import { type BrowserWindow, dialog, shell } from 'electron'

export type UrlSchemeCategory = 'http' | 'file' | 'other'

/**
 * リンクURLを`http`（http:/https:）・`file`（file:）・`other`（それ以外）に分類する。
 * 不正なURL文字列は`other`として扱い、既存挙動（何もしない）を変更しない（008-fix-external-link-nav FR-011）。
 */
export function classifyUrlScheme(url: string): UrlSchemeCategory {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') {
      return 'http'
    }
    if (protocol === 'file:') {
      return 'file'
    }
    return 'other'
  } catch {
    return 'other'
  }
}

/**
 * アプリの起動セッション中のみ有効な一時状態（永続化しない、008-fix-external-link-nav FR-007、data-model.md）。
 * 「以降このセッション中は確認しない」が選択された場合にのみtrueへ遷移し、
 * アプリ終了（プロセス終了）と同時に消滅する。
 */
let skipConfirmation = false

/**
 * 確認ダイアログを介してOS既定のブラウザへ外部リンクを委譲する（008-fix-external-link-nav FR-002〜FR-008）。
 * 起動失敗時はファイルログを残さず、rendererへIPC通知してトースト表示に委ねる（憲法原則V）。
 */
async function openExternalWithConfirmation(
  win: BrowserWindow,
  targetWebContents: Electron.WebContents,
  url: string
): Promise<void> {
  if (!skipConfirmation) {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['開く', 'キャンセル'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: '以降このセッション中は確認しない',
      checkboxChecked: false,
      message: '外部ブラウザでリンクを開きますか？',
      detail: url
    })
    if (result.response !== 0) {
      return
    }
    if (result.checkboxChecked) {
      skipConfirmation = true
    }
  }

  try {
    await shell.openExternal(url)
  } catch {
    targetWebContents.send('external-link-open-failed')
  }
}

/**
 * 本文中のhttp/https/fileリンククリック時、Electronの既定動作のままだとレンダラー全体が
 * その宛先へナビゲートしてしまい、mdviewerの全タブが消失する既存不具合を修正する。
 * will-navigateで常にアプリ内ナビゲーションをブロックし、スキームごとに個別処理する
 * （008-fix-external-link-nav research.md Decision 1）。
 *
 * 033-webcontentsview-search-fix: 4View分離に伴い、外部リンクを監視する対象は
 * 本文ViewのwebContents（`targetWebContents`）に限定する。確認ダイアログの表示元は
 * 引き続き`BaseWindow`基準（`win`）とし、失敗時のトースト通知も本文View（トーストは
 * 本文Viewに属する、research.md Decision 10）へ送る。
 */
export function attachExternalLinkGuard(win: BrowserWindow, targetWebContents: Electron.WebContents): void {
  targetWebContents.on('will-navigate', (event, url) => {
    const scheme = classifyUrlScheme(url)
    if (scheme === 'other') {
      // mailto:/ftp:等、http/https/file以外は既存挙動を変更しない（FR-011）
      return
    }

    event.preventDefault()

    if (scheme === 'http') {
      void openExternalWithConfirmation(win, targetWebContents, url)
    }
    // scheme === 'file' はナビゲーションのみブロックし、OSへは委譲しない（実行可能ファイル誤起動等のリスク回避、FR-009, FR-010）
  })
}
