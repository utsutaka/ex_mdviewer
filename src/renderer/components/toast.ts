/** 全Storyで共有するトースト通知コンポーネント（constitution原則V） */

export type ToastKind = 'info' | 'error'

let container: HTMLDivElement | null = null

function ensureContainer(): HTMLDivElement {
  if (container) {
    return container
  }
  container = document.createElement('div')
  container.className = 'toast-container'
  document.body.appendChild(container)
  return container
}

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 4000): void {
  const root = ensureContainer()
  const el = document.createElement('div')
  el.className = `toast toast--${kind}`
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.textContent = message
  root.appendChild(el)

  requestAnimationFrame(() => el.classList.add('toast--visible'))

  window.setTimeout(() => {
    el.classList.remove('toast--visible')
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }, durationMs)
}
