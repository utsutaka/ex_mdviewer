export interface TabBarCallbacks {
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
}

interface TabElementState {
  tabId: string
  el: HTMLDivElement
}

const tabElements = new Map<string, TabElementState>()
let callbacks: TabBarCallbacks | null = null

function getTabBarEl(): HTMLElement {
  const el = document.getElementById('tab-bar')
  if (!el) {
    throw new Error('tab-bar element not found')
  }
  return el
}

export function initTabBar(cb: TabBarCallbacks): void {
  callbacks = cb
}

function orderedTabIds(): string[] {
  return Array.from(tabElements.keys())
}

/** 矢印キー・Enterによるキーボードのみでのタブ切替、Deleteによるクローズ（FR-031） */
function handleTabKeydown(event: KeyboardEvent, tabId: string): void {
  const ids = orderedTabIds()
  const index = ids.indexOf(tabId)

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    const nextId = ids[Math.min(index + 1, ids.length - 1)]
    tabElements.get(nextId)?.el.focus()
    callbacks?.onActivate(nextId)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    const prevId = ids[Math.max(index - 1, 0)]
    tabElements.get(prevId)?.el.focus()
    callbacks?.onActivate(prevId)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    callbacks?.onActivate(tabId)
  } else if (event.key === 'Delete' || (event.key.toLowerCase() === 'w' && event.ctrlKey)) {
    event.preventDefault()
    callbacks?.onClose(tabId)
  }
}

/**
 * タブを追加する。titleはファイル名から拡張子を除いた文字列をそのまま表示し、
 * 他タブと重複していても区別処理は行わない。ホバー時はネイティブtitle属性で
 * フルパスをツールチップ表示する（FR-039, FR-040）。
 */
export function addTab(tabId: string, filePath: string, title: string): void {
  const bar = getTabBarEl()

  const el = document.createElement('div')
  el.className = 'tab-bar__tab is-loading'
  el.dataset.tabId = tabId
  el.title = filePath
  el.tabIndex = 0
  el.setAttribute('role', 'tab')

  const spinnerEl = document.createElement('span')
  spinnerEl.className = 'tab-bar__spinner'
  spinnerEl.setAttribute('aria-hidden', 'true')

  const labelEl = document.createElement('span')
  labelEl.className = 'tab-bar__label'
  labelEl.textContent = title

  const closeEl = document.createElement('button')
  closeEl.type = 'button'
  closeEl.className = 'tab-bar__close'
  closeEl.textContent = '×'
  closeEl.setAttribute('aria-label', 'タブを閉じる')
  closeEl.addEventListener('click', (event) => {
    event.stopPropagation()
    callbacks?.onClose(tabId)
  })

  el.append(spinnerEl, labelEl, closeEl)
  el.addEventListener('click', () => callbacks?.onActivate(tabId))
  el.addEventListener('keydown', (event) => handleTabKeydown(event, tabId))

  bar.appendChild(el)
  tabElements.set(tabId, { tabId, el })
}

/** file-opened受信時、タブ毎のローディング表示を解除する（FR-034） */
export function markTabLoaded(tabId: string): void {
  tabElements.get(tabId)?.el.classList.remove('is-loading')
}

export function removeTab(tabId: string): void {
  const state = tabElements.get(tabId)
  if (!state) {
    return
  }
  state.el.remove()
  tabElements.delete(tabId)
}

export function setActiveTabUi(tabId: string): void {
  for (const [id, state] of tabElements) {
    state.el.classList.toggle('is-active', id === tabId)
  }
}

export function focusTabUi(tabId: string): void {
  tabElements.get(tabId)?.el.focus()
}

export function hasTab(tabId: string): boolean {
  return tabElements.has(tabId)
}

export function tabCount(): number {
  return tabElements.size
}

export function firstTabId(): string | undefined {
  return orderedTabIds()[0]
}
