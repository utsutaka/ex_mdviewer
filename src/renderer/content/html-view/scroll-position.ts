import type { TabRuntime } from '../main'

/**
 * 非アクティブ化されるHTML表示タブのスクロール位置を`TabRuntime.htmlScrollPosition`へ記録する
 * （036-iframe-html-view FR-011、research.md Decision 6）。`tab.containerEl`をDOMツリーから
 * `removeChild`する直前に呼ぶ必要がある（detach後は`iframe.contentWindow`が消失するため）。
 * HTML表示タブ以外、またはiframeの`contentWindow`が取得できない場合は何もしない
 * （data-model.md Validation: 異常系はエラーとせず記録処理をスキップする）。
 */
export function recordHtmlScrollPosition(tab: TabRuntime): void {
  if (tab.fileKind !== 'html') {
    return
  }
  const iframe = tab.containerEl.querySelector<HTMLIFrameElement>('iframe')
  if (iframe?.contentWindow) {
    tab.htmlScrollPosition = iframe.contentWindow.scrollY
  }
}

/**
 * HTML表示タブの再アクティブ化時、記録済みスクロール位置を復元する（036-iframe-html-view FR-011）。
 * iframeはdetach/reattachで`src`から再読み込みされるため、`load`完了を待ってからスクロールする。
 * 同じ値を再適用し続けないよう、呼び出し時点で`tab.htmlScrollPosition`を即座に`null`へリセットする
 * （data-model.md ライフサイクル）。iframeが存在しない、または記録値が`null`の場合は何もしない。
 */
export function restoreHtmlScrollPosition(tab: TabRuntime): void {
  const iframe = tab.containerEl.querySelector<HTMLIFrameElement>('iframe')
  const position = tab.htmlScrollPosition
  tab.htmlScrollPosition = null
  if (!iframe || position === null) {
    return
  }
  iframe.addEventListener(
    'load',
    () => {
      iframe.contentWindow?.scrollTo(0, position)
    },
    { once: true }
  )
}
