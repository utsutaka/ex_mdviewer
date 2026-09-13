import type { ExplorerEntry, FileKind, FolderListUpdatedPayload } from '@shared/types'

function getListEl(): HTMLElement {
  const el = document.getElementById('sidebar-explorer-list')
  if (!el) {
    throw new Error('sidebar-explorer-list element not found')
  }
  return el
}

/**
 * ファイル種別ごとのアイコン（固定のSVG文字列のみで構成され、ファイル名等の可変値は
 * 一切含まない。絵文字は使わずstroke/塗りベースの単色アイコンとする、design skill方針）。
 * `innerHTML`は使わず、`DOMParser`で一度だけ解析した要素を`cloneNode`して挿入する
 * （security-guidance: innerHTMLへの外部由来文字列混入を避ける）。
 */
const FILE_KIND_ICON_MARKUP: Record<FileKind, string> = {
  markdown: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h6.5L13 4.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="var(--accent-color)"/><path d="M9.5 1v3.5H13" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55"/><text x="8" y="12.5" font-size="5" font-family="Consolas, monospace" font-weight="700" fill="#ffffff" text-anchor="middle">MD</text></svg>`,
  json: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h6.5L13 4.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="#d19a3a"/><path d="M9.5 1v3.5H13" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55"/><text x="8" y="12" font-size="6" font-family="Consolas, monospace" font-weight="700" fill="#ffffff" text-anchor="middle">{}</text></svg>`,
  yaml: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h6.5L13 4.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="#8e5bc7"/><path d="M9.5 1v3.5H13" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55"/><text x="8" y="12" font-size="4" font-family="Consolas, monospace" font-weight="700" fill="#ffffff" text-anchor="middle">YML</text></svg>`,
  xml: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h6.5L13 4.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="#1f9c86"/><path d="M9.5 1v3.5H13" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55"/><text x="8" y="12" font-size="4" font-family="Consolas, monospace" font-weight="700" fill="#ffffff" text-anchor="middle">XML</text></svg>`,
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h6.5L13 4.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="#e07a2c"/><path d="M9.5 1v3.5H13" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55"/><text x="8" y="12" font-size="4" font-family="Consolas, monospace" font-weight="700" fill="#ffffff" text-anchor="middle">&lt;/&gt;</text></svg>`,
  pdf: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1h6.5L13 4.5V15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="#c0392b"/><path d="M9.5 1v3.5H13" fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55"/><text x="8" y="12" font-size="4" font-family="Consolas, monospace" font-weight="700" fill="#ffffff" text-anchor="middle">PDF</text></svg>`
}

const svgParser = new DOMParser()

function parseFileKindIcons(): Record<FileKind, SVGElement> {
  const entries = Object.entries(FILE_KIND_ICON_MARKUP) as [FileKind, string][]
  return Object.fromEntries(
    entries.map(([fileKind, markup]) => [fileKind, svgParser.parseFromString(markup, 'image/svg+xml').documentElement as unknown as SVGElement])
  ) as Record<FileKind, SVGElement>
}

/** `DOMParser`で一度だけ解析済みのアイコン要素（描画のたびに`cloneNode`して使う） */
const FILE_KIND_ICONS = parseFileKindIcons()

function openFile(filePath: string): void {
  window.explorerApi.openFile(filePath)
}

/** 空状態メッセージ要素（FR-020, research.md Decision 7） */
function createEmptyStateEl(): HTMLElement {
  const el = document.createElement('p')
  el.className = 'sidebar-explorer__empty'
  el.textContent = '対応するファイルがありません'
  return el
}

/**
 * 矢印キー・Enterによるキーボードのみでの操作（FR-017）を、目次バーの
 * `023-toc-keyboard-nav`と同じroving tabindexパターンで実現する。
 */
function initKeyboardNavigation(container: HTMLElement): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>('.sidebar-explorer__item'))
  if (items.length === 0) {
    return
  }

  const focusItem = (nextIndex: number): void => {
    items.forEach((el) => {
      el.tabIndex = -1
    })
    const target = items[nextIndex]
    target.tabIndex = 0
    target.focus()
  }
  items.forEach((el, index) => {
    el.tabIndex = index === 0 ? 0 : -1
  })

  items.forEach((el, index) => {
    el.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusItem(Math.min(index + 1, items.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusItem(Math.max(index - 1, 0))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        el.click()
      } else if (event.key === 'Tab' && !event.shiftKey) {
        // 塊単位のフォーカス巡回・前方向のみ（039-tab-reorder-keyboard-nav FR-006〜FR-011）。
        // roving tabindexの項目は一覧内で最後の要素のため、Tabキーは次の塊（本文）へ直接移動する。
        // Shift+Tabは一覧内の1つ前の要素（×ボタン）へネイティブ挙動で戻るため、ここでは処理しない。
        event.preventDefault()
        window.explorerApi.requestFocusCycle('next')
      }
    })
  })
}

/**
 * 塊への入場時（Tab/Shift+Tabで他の塊からエクスプローラーバーへ移動してきた場合）、
 * 直前にフォーカスしていた項目（roving tabindexで`tabIndex=0`の項目）へフォーカスする
 * （039-tab-reorder-keyboard-nav、research.md Decision 5、`023-toc-keyboard-nav`と同じ方式）。
 */
function initFocusCycleEnteredListener(): void {
  window.explorerApi.onFocusCycleEntered(() => {
    getListEl().querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  })
}

/**
 * エクスプローラーバーの一覧を再構築する（FR-001〜FR-003）。各項目にFR-018の3状態
 * （`active`/`open`/`closed`）に対応するCSSクラスを付与し（FR-018）、一覧が空の場合は
 * 空状態メッセージを表示する（FR-020）。クリックで該当ファイルを開く（FR-005）。
 */
function renderList(entries: ExplorerEntry[]): void {
  const list = getListEl()
  list.innerHTML = ''

  if (entries.length === 0) {
    list.appendChild(createEmptyStateEl())
    return
  }

  for (const entry of entries) {
    const item = document.createElement('div')
    item.className = 'sidebar-explorer__item'
    if (entry.state === 'active') {
      item.classList.add('is-active')
    } else if (entry.state === 'open') {
      item.classList.add('is-open')
    }
    item.setAttribute('role', 'treeitem')

    const icon = document.createElement('span')
    icon.className = 'sidebar-explorer__icon'
    icon.appendChild(FILE_KIND_ICONS[entry.fileKind].cloneNode(true))

    const label = document.createElement('span')
    label.className = 'sidebar-explorer__label'
    label.textContent = entry.name
    label.title = entry.name

    item.append(icon, label)

    // 「別タブで開いている」状態を色だけに頼らず形状でも示す小さなドット（FR-018 (b)）
    if (entry.state === 'open') {
      const dot = document.createElement('span')
      dot.className = 'sidebar-explorer__dot'
      dot.setAttribute('aria-hidden', 'true')
      item.appendChild(dot)
    }

    item.addEventListener('click', () => openFile(entry.filePath))
    list.appendChild(item)
  }

  initKeyboardNavigation(list)
}

function initFolderListUpdatedListener(): void {
  window.explorerApi.onFolderListUpdated((payload: FolderListUpdatedPayload) => {
    renderList(payload.entries)
  })
}

function initThemeListener(): void {
  window.explorerApi.onThemeUpdated((theme) => {
    document.documentElement.classList.remove('theme-light', 'theme-dark')
    document.documentElement.classList.add(`theme-${theme}`)
  })
}

let explorerVisible = true

function getExplorerVisible(): boolean {
  return explorerVisible
}

/** エクスプローラーバーの表示・非表示を切り替え、AppSettingsへ永続化する（FR-006, FR-008, FR-013） */
function setExplorerVisible(visible: boolean): void {
  explorerVisible = visible
  window.explorerApi.explorerVisibilityChanged(visible)
}

/** 起動時の表示状態反映。IPC送出は行わない（`sidebar-toc/main.ts`の`initTocVisible`と同型） */
function initExplorerVisible(initialVisible: boolean): void {
  explorerVisible = initialVisible
}

/** バー右上の×ボタン（FR-008）。メニュー項目と同一の`setExplorerVisible`経路を共有する */
function initExplorerCloseButton(): void {
  const button = document.getElementById('sidebar-explorer-close')
  button?.addEventListener('click', () => {
    setExplorerVisible(!getExplorerVisible())
  })
  // ×ボタンはエクスプローラーバー内で最初にフォーカス可能な要素のため、Shift+Tabキーは
  // 前の塊（tab塊）へ直接移動する（039-tab-reorder-keyboard-nav FR-006〜FR-011）。
  button?.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      window.explorerApi.requestFocusCycle('prev')
    }
  })
}

/** ネイティブメニュー「エクスプローラーを隠す」の表示切替要求 */
function initMenuExplorerVisibilityToggleListener(): void {
  window.explorerApi.onMenuExplorerVisibilityToggleRequested(() => {
    setExplorerVisible(!getExplorerVisible())
  })
}

/**
 * エクスプローラーサイドバーViewのどこにフォーカスがあってもPageUp/PageDownで
 * 本文をスクロールする（040-content-scroll-anywhere FR-001）。captureフェーズで
 * 購読することで、ファイルツリー項目にフォーカスがあっても取りこぼさず、ファイルツリー
 * 自体のネイティブなページスクロールより本文スクロールを優先させる（research.md
 * Decision 1、FR-005）。
 */
function initPageScrollListener(): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'PageUp') {
        event.preventDefault()
        window.explorerApi.scrollContent('up')
      } else if (event.key === 'PageDown') {
        event.preventDefault()
        window.explorerApi.scrollContent('down')
      }
    },
    { capture: true }
  )
}

const EXPLORER_WIDTH_MIN = 150
const EXPLORER_WIDTH_MAX = 480
const EXPLORER_WIDTH_DEFAULT = 240

function clampExplorerWidth(width: number): number {
  return Math.min(EXPLORER_WIDTH_MAX, Math.max(EXPLORER_WIDTH_MIN, width))
}

let explorerWidth = EXPLORER_WIDTH_DEFAULT

/** ドラッグ確定・ダブルクリックリセット時の幅変更。永続化を伴う（FR-011〜FR-013） */
function setExplorerWidth(width: number): void {
  explorerWidth = clampExplorerWidth(width)
  window.explorerApi.explorerWidthChanged(explorerWidth)
}

/** 起動時の幅反映。IPC送出は行わない（`sidebar-toc/main.ts`の`initTocWidth`と同型） */
function initExplorerWidth(initialWidth: number): void {
  explorerWidth = clampExplorerWidth(initialWidth)
}

/**
 * リサイズハンドルへのドラッグ操作（Pointer Events）とダブルクリックによる既定幅リセットを
 * 配線する（FR-010〜FR-012, FR-015、research.md Decision 6）。真のリアルタイム視覚追従のため、
 * `pointermove`ごとに`requestAnimationFrame`で間引きつつ、永続化を伴わない
 * `explorerWidthPreview`を送信してmainプロセス側の`relayoutViews`を都度呼び出させる。
 * 確定・永続化（`explorerWidthChanged`）は`pointerup`でのみ送信する（`021-toc-sidebar-resize`
 * の単一チャネル方式とは異なる設計、research.md Decision 6の「重要な発見」参照）。
 */
function initExplorerResizeHandle(): void {
  const handle = document.getElementById('explorer-resize-handle')
  if (!handle) {
    return
  }

  let dragStartX = 0
  let dragStartWidth = EXPLORER_WIDTH_DEFAULT
  let previewFrame: number | null = null
  let pendingPreviewWidth: number | null = null

  const flushPreview = (): void => {
    previewFrame = null
    if (pendingPreviewWidth === null) {
      return
    }
    window.explorerApi.explorerWidthPreview(pendingPreviewWidth)
    pendingPreviewWidth = null
  }

  handle.addEventListener('pointerdown', (event) => {
    if (!getExplorerVisible()) {
      return
    }
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    dragStartX = event.clientX
    dragStartWidth = explorerWidth
  })

  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return
    }
    pendingPreviewWidth = clampExplorerWidth(dragStartWidth + (event.clientX - dragStartX))
    if (previewFrame === null) {
      previewFrame = requestAnimationFrame(flushPreview)
    }
  })

  handle.addEventListener('pointerup', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return
    }
    handle.releasePointerCapture(event.pointerId)
    handle.classList.remove('is-dragging')
    if (previewFrame !== null) {
      cancelAnimationFrame(previewFrame)
      previewFrame = null
      pendingPreviewWidth = null
    }
    setExplorerWidth(dragStartWidth + (event.clientX - dragStartX))
  })

  handle.addEventListener('dblclick', () => {
    if (!getExplorerVisible()) {
      return
    }
    setExplorerWidth(EXPLORER_WIDTH_DEFAULT)
  })
}

async function init(): Promise<void> {
  const settings = await window.explorerApi.getAppSettings()
  document.documentElement.classList.add(`theme-${settings.theme}`)
  initExplorerVisible(settings.explorerVisible)
  initExplorerWidth(settings.explorerWidth)
  initFolderListUpdatedListener()
  initThemeListener()
  initExplorerCloseButton()
  initMenuExplorerVisibilityToggleListener()
  initExplorerResizeHandle()
  initFocusCycleEnteredListener()
  initPageScrollListener()
}

void init()
