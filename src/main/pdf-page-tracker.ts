import type { BrowserWindow } from 'electron'
import type { PdfPageInfoPayload } from '@shared/types'

interface PollingState {
  intervalId: NodeJS.Timeout
  lastPageNo: number | null
  lastTotalPages: number | null
  consecutiveNullCount: number
}

const pollingStates = new Map<string, PollingState>()

/**
 * ポーリング間隔。利用者のスクロール操作からページ番号表示の更新までの体感遅延が
 * 1秒未満であれば違和感なく追従して見える一方、それより短い間隔ではIPC往復の頻度が
 * 増えメインプロセスの負荷が不必要に増えるため、体感速度と負荷のバランスとして採用する
 * （011-html-pdf-viewer research.md Decision 5）。
 */
const POLL_INTERVAL_MS = 1000

/**
 * `pageNo`/`totalPages`が連続でnullだった場合に「恒久的に取得不能」と判断してポーリングを
 * 諦めるまでの許容回数。PDFビューアのロード直後は`pdf-viewer`要素自体は存在していても
 * `pageNo_`等のプロパティがまだ初期化されておらずnullになる一時的な状態があるため、
 * 初回のnullで即座に諦めると、単に「まだロード中だっただけ」のPDFのページ位置が
 * 永久に表示されなくなってしまう（実機検証で確認した不具合）。10秒程度様子を見ても
 * nullが続く場合は、非公開プロパティ自体が存在しない恒久的な状態と判断する。
 */
const MAX_CONSECUTIVE_NULL = 10

interface PollResult {
  pageNo: number | null
  totalPages: number | null
}

function sendAndStop(win: BrowserWindow, tabId: string): void {
  const state = pollingStates.get(tabId)
  if (!state) {
    return
  }
  clearInterval(state.intervalId)
  pollingStates.delete(tabId)
  try {
    const payload: PdfPageInfoPayload = { tabId, pageNo: null, totalPages: null }
    win.webContents.send('pdf-page-info', payload)
  } catch {
    // ウィンドウ・webContentsが既に破棄されている場合等、通知に失敗しても致命的エラーにはしない
  }
}

/**
 * PDFの`<iframe>`（`name`属性にtabIdを設定済み、render-pdf.ts参照）に対応する
 * PDFビューア拡張機能フレーム（孫フレーム）を取得する。`framesInSubtree`でサブツリー全体を
 * 検索することで、複数のPDFタブが存在する場合でも正しいタブのフレームを一意に特定できる
 * （`frames[0]`への決め打ちでは複数タブ時に誤ったフレームを参照してしまうため）。
 */
function findPdfViewerFrame(win: BrowserWindow, tabId: string): Electron.WebFrameMain | undefined {
  const containerFrame = win.webContents.mainFrame.framesInSubtree.find((frame) => frame.name === tabId)
  return containerFrame?.frames[0]
}

/**
 * フレーム構造へのアクセス・`executeJavaScript`の呼び出しはいずれも、対象フレームが
 * ロード中・破棄中である競合状態で例外を投げる可能性があるため、関数全体を`try`で囲み
 * 想定外の例外が`uncaughtException`まで伝播しない（致命的エラーダイアログ化しない）ようにする。
 */
async function poll(win: BrowserWindow, tabId: string): Promise<void> {
  try {
    const state = pollingStates.get(tabId)
    if (!state) {
      return
    }

    const viewerFrame = findPdfViewerFrame(win, tabId)
    if (!viewerFrame || viewerFrame.isDestroyed()) {
      // 孫フレーム（PDFビューア拡張機能）がまだ生成されていない場合は次回ポーリングまで待つ
      return
    }

    const result = (await viewerFrame.executeJavaScript(
      `(() => {
        const v = document.querySelector('pdf-viewer')
        return JSON.stringify({ pageNo: v?.pageNo_ ?? null, totalPages: v?.documentDimensions?.pageDimensions?.length ?? null })
      })()`
    )) as string
    const parsed = JSON.parse(result) as PollResult

    if (parsed.pageNo === null || parsed.totalPages === null) {
      // ロード直後の一時的なnullかもしれないため、MAX_CONSECUTIVE_NULL回連続するまでは
      // ポーリングを継続する（次回のpoll呼び出しに委ねる）
      state.consecutiveNullCount += 1
      if (state.consecutiveNullCount >= MAX_CONSECUTIVE_NULL) {
        sendAndStop(win, tabId)
      }
      return
    }
    state.consecutiveNullCount = 0
    if (parsed.pageNo !== state.lastPageNo || parsed.totalPages !== state.lastTotalPages) {
      state.lastPageNo = parsed.pageNo
      state.lastTotalPages = parsed.totalPages
      const payload: PdfPageInfoPayload = { tabId, pageNo: parsed.pageNo, totalPages: parsed.totalPages }
      win.webContents.send('pdf-page-info', payload)
    }
  } catch {
    // pageNo_・documentDimensions等の非公開プロパティが取得できない場合のフォールバック
    // （research.md Decision 5 Risk）。エラーとして通知せず表示欄を非表示にするのみ。
    sendAndStop(win, tabId)
  }
}

/**
 * Chromium内蔵PDFビューア（`<iframe>`埋め込み、`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/`）
 * の内部プロパティをメインプロセスの`WebFrameMain.executeJavaScript()`経由でポーリング取得し、
 * rendererへ通知する（011-html-pdf-viewer FR-017, FR-018、research.md Decision 5）。
 * `pageNo_`・`documentDimensions.pageDimensions.length`はいずれも非公開プロパティであり、
 * Electron/Chromiumのバージョンアップにより取得できなくなる可能性がある。
 */
export function startPdfPageTracking(win: BrowserWindow, tabId: string): void {
  if (pollingStates.has(tabId)) {
    return
  }
  const intervalId = setInterval(() => void poll(win, tabId), POLL_INTERVAL_MS)
  pollingStates.set(tabId, { intervalId, lastPageNo: null, lastTotalPages: null, consecutiveNullCount: 0 })
  void poll(win, tabId)
}

/** PDFタブの非アクティブ化・クローズ時にポーリングを停止する（FR-018） */
export function stopPdfPageTracking(tabId: string): void {
  const state = pollingStates.get(tabId)
  if (!state) {
    return
  }
  clearInterval(state.intervalId)
  pollingStates.delete(tabId)
}
