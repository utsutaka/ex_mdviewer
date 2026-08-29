/** 致命的エラー通知用のモーダルダイアログコンポーネント（FR-036、constitution原則V） */

export function showFatalErrorModal(message: string): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const dialog = document.createElement('div')
  dialog.className = 'modal-dialog'
  dialog.setAttribute('role', 'alertdialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'modal-dialog-title')

  const title = document.createElement('h2')
  title.id = 'modal-dialog-title'
  title.className = 'modal-dialog__title'
  title.textContent = '致命的なエラーが発生しました'

  const body = document.createElement('p')
  body.className = 'modal-dialog__body'
  body.textContent = message

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'modal-dialog__close'
  closeButton.textContent = '閉じる'
  closeButton.addEventListener('click', () => overlay.remove())

  dialog.append(title, body, closeButton)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
  closeButton.focus()
}
