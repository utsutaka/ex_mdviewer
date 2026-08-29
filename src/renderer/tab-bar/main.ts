import {
  addTab,
  firstTabId,
  focusTabUi,
  initTabBar,
  markTabLoaded,
  removeTab,
  setActiveTabUi,
  setTabDisplayModeUi
} from './components/tab-bar'
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

/** タブバーUI・アクティブタブ状態を指定タブへ切り替え、本文Viewへアクティブ化を要求する（FR-008, FR-009） */
function setActiveTab(tabId: string): void {
  activeTabId = tabId
  setActiveTabUi(tabId)
  window.tabBarApi.activateTab(tabId)
}

async function closeTab(tabId: string): Promise<void> {
  const response = await window.tabBarApi.closeTab(tabId)

  tabs.delete(tabId)
  removeTab(tabId)

  if (response.windowClosed) {
    return
  }

  if (activeTabId === tabId) {
    const nextId = firstTabId()
    if (nextId) {
      setActiveTab(nextId)
    } else {
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

/** タブが生成された直後、読み込み完了を待たずタブ領域を追加する（FR-034） */
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
    addTab(payload.tabId, payload.filePath, payload.title, fileKind)
    setActiveTab(payload.tabId)
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

async function init(): Promise<void> {
  const settings = await window.tabBarApi.getAppSettings()
  currentTheme = settings.theme
  document.documentElement.classList.add(`theme-${settings.theme}`)

  initTabBarUi()
  initTabCreatedListener()
  initFocusTabListener()
  initDisplayModeChangedListener()
  initTabLoadedListener()
  initMenuThemeToggleListener()
  initThemeListener()
  initDragAndDrop()
  initSearchShortcut()
}

void init()
