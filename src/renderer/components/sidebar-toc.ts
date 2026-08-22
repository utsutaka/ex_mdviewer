import type { Heading } from '@shared/types'

function getSidebarEl(): HTMLElement {
  const el = document.getElementById('sidebar-toc')
  if (!el) {
    throw new Error('sidebar-toc element not found')
  }
  return el
}

/** 指定アンカーIDの見出しへスクロールする。本文内リンクのジャンプ処理（main.ts）とも共有する */
export function scrollToHeading(anchorId: string, contentContainerEl: HTMLElement): void {
  if (!anchorId) {
    return
  }
  const target = contentContainerEl.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 見出しツリーからネストしたリストを構築する。見出し数が極端に多い文書でも
 * メインスレッドを長時間占有しないよう、一定件数ごとにイベントループへ処理を委譲する
 * （FR-015相当の防御的対応。通常の見出し数では実質的にawaitは発生しない）。
 */
async function buildListAsync(
  headings: Heading[],
  contentContainerEl: HTMLElement,
  counter: { count: number },
  interactive: boolean
): Promise<HTMLUListElement> {
  const ul = document.createElement('ul')
  ul.setAttribute('role', 'group')

  for (const heading of headings) {
    const li = document.createElement('li')
    const link = document.createElement('a')
    link.href = `#${heading.anchorId}`
    link.textContent = heading.text
    link.setAttribute('role', 'treeitem')
    link.tabIndex = 0
    if (!interactive) {
      // raw表示中はTOCの表示自体を維持しつつ、クリック（キーボードのEnter経由も含む）を無効化する（019-raw-source-toggle FR-012）
      link.classList.add('toc-link--disabled')
    }
    link.addEventListener('click', (event) => {
      event.preventDefault()
      if (!interactive) {
        return
      }
      scrollToHeading(heading.anchorId, contentContainerEl)
    })
    li.appendChild(link)

    if (heading.children.length > 0) {
      li.appendChild(await buildListAsync(heading.children, contentContainerEl, counter, interactive))
    }
    ul.appendChild(li)

    counter.count += 1
    if (counter.count % 500 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  return ul
}

/** 矢印キー・Enterによるキーボードのみでのジャンプ操作（FR-029） */
function initKeyboardNavigation(sidebar: HTMLElement): void {
  const links = Array.from(sidebar.querySelectorAll<HTMLAnchorElement>('a'))
  links.forEach((link, index) => {
    link.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        links[Math.min(index + 1, links.length - 1)]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        links[Math.max(index - 1, 0)]?.focus()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        link.click()
      }
    })
  })
}

/**
 * アクティブタブのTOCサイドバーを再構築する（FR-003, FR-004）。
 * `interactive: false`の場合、TOCの表示自体は維持しつつ項目クリックによる
 * ジャンプ操作のみを無効化する（019-raw-source-toggle FR-012、raw表示中に使用）。
 */
export async function renderToc(
  headings: Heading[],
  contentContainerEl: HTMLElement,
  interactive = true
): Promise<void> {
  const sidebar = getSidebarEl()
  sidebar.innerHTML = ''
  if (headings.length === 0) {
    return
  }
  sidebar.setAttribute('role', 'tree')
  const listEl = await buildListAsync(headings, contentContainerEl, { count: 0 }, interactive)
  sidebar.appendChild(listEl)
  initKeyboardNavigation(sidebar)
}

let tocVisible = true

/** TOCサイドバーの現在の表示状態を返す */
export function getTocVisible(): boolean {
  return tocVisible
}

/** TOCサイドバーの表示・非表示を切り替え、AppSettingsへ永続化する（003-toc-toggle FR-001, FR-005） */
export function setTocVisible(visible: boolean): void {
  tocVisible = visible
  document.documentElement.classList.toggle('toc-hidden', !visible)
  window.api.tocVisibilityChanged(visible)
}

/** 起動時、永続化済みの表示状態を適用する（IPC送出は行わない） */
export function initTocVisible(initialVisible: boolean): void {
  tocVisible = initialVisible
  document.documentElement.classList.toggle('toc-hidden', !initialVisible)
}

const TOC_WIDTH_MIN = 150
const TOC_WIDTH_MAX = 480
const TOC_WIDTH_DEFAULT = 220

function clampTocWidth(width: number): number {
  return Math.min(TOC_WIDTH_MAX, Math.max(TOC_WIDTH_MIN, width))
}

function applyTocWidth(width: number): void {
  document.documentElement.style.setProperty('--toc-width', `${width}px`)
}

let tocWidth = TOC_WIDTH_DEFAULT

/** TOCサイドバーの現在の幅（px）を返す */
export function getTocWidth(): number {
  return tocWidth
}

/** TOCサイドバーの幅を150〜480pxへクランプして確定し、AppSettingsへ永続化する（021-toc-sidebar-resize FR-003, FR-005） */
export function setTocWidth(width: number): void {
  tocWidth = clampTocWidth(width)
  applyTocWidth(tocWidth)
  window.api.tocWidthChanged(tocWidth)
}

/** 起動時、永続化済みの幅を適用する（IPC送出は行わない） */
export function initTocWidth(initialWidth: number): void {
  tocWidth = clampTocWidth(initialWidth)
  applyTocWidth(tocWidth)
}

/**
 * リサイズハンドルへのドラッグ操作（Pointer Events）とダブルクリックによる既定幅リセットを配線する
 * （FR-002, FR-007, FR-008、research.md Decision 1, 3, 6）。
 */
function initTocResizeHandle(): void {
  const handle = document.getElementById('toc-resize-handle')
  if (!handle) {
    return
  }

  let dragStartX = 0
  let dragStartWidth = TOC_WIDTH_DEFAULT

  handle.addEventListener('pointerdown', (event) => {
    // TOC非表示中はリサイズハンドルを操作不可にする（FR-007）
    if (!getTocVisible()) {
      return
    }
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    dragStartX = event.clientX
    dragStartWidth = tocWidth
  })

  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return
    }
    // ドラッグ中はCSS変数の更新のみでリアルタイムに追従させ、確定（永続化）はpointerupまで行わない
    applyTocWidth(clampTocWidth(dragStartWidth + (event.clientX - dragStartX)))
  })

  handle.addEventListener('pointerup', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return
    }
    handle.releasePointerCapture(event.pointerId)
    handle.classList.remove('is-dragging')
    setTocWidth(dragStartWidth + (event.clientX - dragStartX))
  })

  handle.addEventListener('dblclick', () => {
    if (!getTocVisible()) {
      return
    }
    setTocWidth(TOC_WIDTH_DEFAULT)
  })
}

initTocResizeHandle()
