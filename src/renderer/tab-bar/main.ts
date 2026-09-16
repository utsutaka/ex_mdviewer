import {
  addTab,
  firstTabId,
  focusTabUi,
  getLastActiveTabId,
  getRowOf,
  initTabBar,
  markTabLoaded,
  mergeLowerIntoUpper,
  removeTab,
  setActiveTabUi,
  setRowVisible,
  setTabDisplayModeUi
} from './components/tab-bar'
import type { Row } from './components/tab-bar'
import type { DisplayMode, DisplayModeChangedPayload, FileKind, FocusTabPayload, TabCreatedPayload, Theme } from '@shared/types'
import { isRawToggleSupported, resolveFileKind } from '@shared/file-kind'

/** タブバーViewが保持するタブのメタ情報（data-model.md TabBarMetadata） */
interface TabBarMetadata {
  tabId: string
  filePath: string
  title: string
  fileKind: FileKind
  displayMode: DisplayMode
}

const tabs = new Map<string, TabBarMetadata>()
let activeTabId = ''
/**
 * 二段バーの利用有無（041-two-row-tab-bar FR-001〜FR-005）。設定の永続化・メニューの
 * チェック状態はmainプロセス側の`AppSettings.twoRowTabBarEnabled`が真実の情報源であり、
 * この変数は現在のDOM表示状態（下段が可視かどうか）と常に一致させるローカルミラーである。
 */
let twoRowTabBarEnabled = false

/** タブバーUI・アクティブタブ状態を指定タブへ切り替え、本文Viewへアクティブ化を要求する（FR-008, FR-009） */
function setActiveTab(tabId: string): void {
  activeTabId = tabId
  setActiveTabUi(tabId)
  window.tabBarApi.activateTab(tabId)
}

async function closeTab(tabId: string): Promise<void> {
  // 041-two-row-tab-bar FR-017, FR-018: 閉じた後はDOMから除去され段の判定ができなくなるため、
  // removeTabを呼ぶ前に所属していた段を記録しておく。
  const closedTabRow = getRowOf(tabId)
  const response = await window.tabBarApi.closeTab(tabId)

  tabs.delete(tabId)
  removeTab(tabId)

  if (response.windowClosed) {
    return
  }

  if (activeTabId === tabId) {
    // まず閉じたタブと同じ段の中でのフォールバックを試みる（既存`039`の単一行時と同じ挙動）
    const sameRowNextId = firstTabId(closedTabRow)
    if (sameRowNextId) {
      setActiveTab(sameRowNextId)
      // tab塊がroving tabindexの単一停止点であり続けるよう、新たにアクティブ化された
      // タブへフォーカスを移す（039-tab-reorder-keyboard-nav FR-019a）。
      focusTabUi(sameRowNextId)
      return
    }
    // 041-two-row-tab-bar FR-017: 閉じたタブの段が0件になった場合、もう一方の段が
    // 記憶しているタブへ本文表示・フォーカスを自動的に切り替える。
    const otherRow: Row = closedTabRow === 'upper' ? 'lower' : 'upper'
    const otherRowFallback = getLastActiveTabId(otherRow)
    if (otherRowFallback) {
      setActiveTab(otherRowFallback)
      focusTabUi(otherRowFallback)
    } else {
      // タブが0件になった場合（FR-009aによりtab塊自体が巡回対象から除外される）は
      // フォーカス移動を行わない。
      activeTabId = ''
    }
  }
}

function toggleDisplayMode(tabId: string): void {
  const tab = tabs.get(tabId)
  if (!tab || !isRawToggleSupported(tab.fileKind)) {
    return
  }
  if (activeTabId !== tabId) {
    setActiveTab(tabId)
  }
  window.tabBarApi.toggleDisplayMode(tabId)
}

function initTabBarUi(): void {
  initTabBar({
    onActivate: (tabId) => setActiveTab(tabId),
    onClose: (tabId) => void closeTab(tabId),
    onToggleDisplayMode: (tabId) => toggleDisplayMode(tabId)
  })
}

/**
 * タブが生成された直後、読み込み完了を待たずタブ領域を追加する（FR-034）。
 * 041-two-row-tab-bar FR-015: 経路（エクスプローラーバー／ファイルを開くダイアログ／
 * 履歴メニュー／OS関連付け／行外D&D）によらず、mainプロセス側は区別せず同一の
 * `tab-created`を送るため、ここで「現在アクティブな段」（＝現在アクティブなタブが
 * 属する段、まだタブが1件もない場合は既定で上段）を判定するだけで全経路に一貫して適用される。
 */
function initTabCreatedListener(): void {
  window.tabBarApi.onTabCreated((payload: TabCreatedPayload) => {
    const fileKind = resolveFileKind(payload.filePath) ?? 'markdown'
    tabs.set(payload.tabId, {
      tabId: payload.tabId,
      filePath: payload.filePath,
      title: payload.title,
      fileKind,
      displayMode: 'rendered'
    })
    const targetRow: Row = activeTabId ? getRowOf(activeTabId) : 'upper'
    addTab(payload.tabId, payload.filePath, payload.title, fileKind, targetRow)
    setActiveTab(payload.tabId)
    // ファイルを開いた直後にどこにもフォーカスが無くTabキーが効かない不具合の修正
    // （039-tab-reorder-keyboard-nav FR-006a、041-two-row-tab-bar FR-015a）。
    // 新規タブへDOMフォーカスを当てる（追加先の段によらず機能する）
    focusTabUi(payload.tabId)
  })
}

/** 同一ファイルの重複オープン要求時、既存タブへフォーカスする（FR-038） */
function initFocusTabListener(): void {
  window.tabBarApi.onFocusTab((payload: FocusTabPayload) => {
    if (!tabs.has(payload.tabId)) {
      return
    }
    setActiveTab(payload.tabId)
    focusTabUi(payload.tabId)
  })
}

function initDisplayModeChangedListener(): void {
  window.tabBarApi.onDisplayModeChanged((payload: DisplayModeChangedPayload) => {
    const tab = tabs.get(payload.tabId)
    if (!tab) {
      return
    }
    tab.displayMode = payload.displayMode
    setTabDisplayModeUi(payload.tabId, payload.displayMode)
  })
}

/** 本文Viewでのfile-opened受信（読み込み完了）に連動した、タブ毎のローディング表示解除（FR-034） */
function initTabLoadedListener(): void {
  window.tabBarApi.onTabLoaded((tabId) => {
    markTabLoaded(tabId)
  })
}

/** HTML5 Drag and Dropでファイルを開く（FR-001, FR-014: タブバー領域でも受け付ける） */
function initDragAndDrop(): void {
  window.addEventListener('dragover', (event) => {
    event.preventDefault()
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) {
      return
    }
    for (const file of Array.from(files)) {
      const filePath = window.tabBarApi.getPathForFile(file)
      window.tabBarApi.openFile(filePath)
    }
  })
}

/**
 * Ctrl+Fで検索欄を開く/フォーカスする（判定はmainプロセス側に集約）。
 * F3/Shift+F3は、フォーカスがタブバー上にあってもページ内検索の次/前候補へ
 * 移動できるようにする（実機フィードバック対応）。
 * F3はタブの操作とは無関係だが、クリックでアクティブ化した`.tab-bar__tab`
 * （`tabIndex=0`）にDOMフォーカスが残っている状態でキー入力が発生すると、
 * ブラウザの`:focus-visible`判定によりタブに青い枠が表示されてしまう不具合が
 * 実機で確認された。タブの活性状態自体はDOMフォーカスに依存しないため、
 * F3処理後に明示的にblurして枠を消す。
 */
function initSearchShortcut(): void {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      window.tabBarApi.requestSearchFocus()
    } else if (event.key === 'F3' && !event.defaultPrevented) {
      event.preventDefault()
      window.tabBarApi.requestFindNext(!event.shiftKey)
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }
  })
}

/**
 * ネイティブメニュー「表示」＞テーマ切替要求（005-native-menu-save-toggle FR-003）。
 * テーマの現在値保持・トグル判定はタブバーView（常時存在するViewの1つ）が担い、
 * 確定値をmainプロセス経由で4View全てへ配信する（research.md Decision 6）。
 */
let currentTheme: Theme = 'light'
function initMenuThemeToggleListener(): void {
  window.tabBarApi.onMenuThemeToggleRequested(() => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.remove('theme-light', 'theme-dark')
    document.documentElement.classList.add(`theme-${currentTheme}`)
    window.tabBarApi.themeChanged(currentTheme)
  })
}

function initThemeListener(): void {
  window.tabBarApi.onThemeUpdated((theme) => {
    currentTheme = theme
    document.documentElement.classList.remove('theme-light', 'theme-dark')
    document.documentElement.classList.add(`theme-${theme}`)
  })
}

/**
 * 編集メニュー「二段バーを利用」チェックボックス（041-two-row-tab-bar FR-001）。
 * ON化: 下段を可視化するのみでよい（既存タブは元々すべて上段のDOMに属しているため、
 * 振り分け処理自体は不要、FR-005）。OFF化: 先に下段の全タブを上段へ統合してから
 * （`mergeLowerIntoUpper`、FR-019）下段を非表示にする。確定した新しい状態を
 * mainプロセスへ送り返し、永続化・メニューのチェック状態更新・View高さの再計算
 * （`relayoutViews`）を行ってもらう（contracts/ipc-contract-delta.md）。
 */
function initMenuTwoRowTabBarToggleListener(): void {
  window.tabBarApi.onMenuTwoRowTabBarToggleRequested(() => {
    twoRowTabBarEnabled = !twoRowTabBarEnabled
    if (twoRowTabBarEnabled) {
      setRowVisible('lower', true)
    } else {
      mergeLowerIntoUpper()
      setRowVisible('lower', false)
    }
    window.tabBarApi.twoRowTabBarVisibilityChanged(twoRowTabBarEnabled)
  })
}

/**
 * タブバーViewのどこにフォーカスがあってもPageUp/PageDownで本文をスクロールする
 * （040-content-scroll-anywhere FR-001）。`tab-bar/components/tab-bar.ts`の
 * `rawToggleEl`（`</>`表示切替ボタン）がkeydownで無条件に`event.stopPropagation()`を
 * 呼んでいる（039-tab-reorder-keyboard-nav Decision 2、Enter/Spaceキーのネイティブ
 * click変換を阻害しないための既存実装）ため、bubbleフェーズの`window`購読ではこの
 * ボタンにフォーカスがある間のPageUp/PageDownを取りこぼす。captureフェーズで購読する
 * ことで、イベントが対象要素に到達し`stopPropagation()`が呼ばれる前に確実に検知する
 * （research.md Decision 1）。
 */
function initPageScrollListener(): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'PageUp') {
        event.preventDefault()
        window.tabBarApi.scrollContent('up')
      } else if (event.key === 'PageDown') {
        event.preventDefault()
        window.tabBarApi.scrollContent('down')
      }
    },
    { capture: true }
  )
}

async function init(): Promise<void> {
  const settings = await window.tabBarApi.getAppSettings()
  currentTheme = settings.theme
  document.documentElement.classList.add(`theme-${settings.theme}`)
  // 041-two-row-tab-bar FR-003: 永続化された設定を起動時に反映する。タブ自体は
  // 既存方針（004-remove-tab-persistence）により再起動後は復元されないため、
  // ここでは下段の可視状態を設定するのみでよい（振り分け直しは不要）。
  twoRowTabBarEnabled = settings.twoRowTabBarEnabled
  setRowVisible('lower', twoRowTabBarEnabled)

  initTabBarUi()
  initTabCreatedListener()
  initFocusTabListener()
  initDisplayModeChangedListener()
  initTabLoadedListener()
  initMenuThemeToggleListener()
  initThemeListener()
  initMenuTwoRowTabBarToggleListener()
  initDragAndDrop()
  initSearchShortcut()
  initPageScrollListener()
}

void init()
