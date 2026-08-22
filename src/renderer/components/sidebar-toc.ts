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
