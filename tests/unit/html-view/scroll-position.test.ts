// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { recordHtmlScrollPosition, restoreHtmlScrollPosition } from '../../../src/renderer/content/html-view/scroll-position'
import type { TabRuntime } from '../../../src/renderer/content/main'

function createTab(fileKind: TabRuntime['fileKind'] = 'html'): TabRuntime {
  return {
    tabId: 't1',
    filePath: 'test.html',
    containerEl: document.createElement('div'),
    headings: [],
    fileKind,
    displayMode: 'rendered',
    rawSourceText: '',
    htmlScrollPosition: null
  }
}

describe('recordHtmlScrollPosition', () => {
  it('fileKindがhtml以外の場合は何もしない', () => {
    const tab = createTab('markdown')
    recordHtmlScrollPosition(tab)
    expect(tab.htmlScrollPosition).toBeNull()
  })

  it('iframeが存在しない場合は何もしない', () => {
    const tab = createTab('html')
    recordHtmlScrollPosition(tab)
    expect(tab.htmlScrollPosition).toBeNull()
  })

  it('iframeのcontentWindow.scrollYを記録する', () => {
    const tab = createTab('html')
    const iframe = document.createElement('iframe')
    tab.containerEl.appendChild(iframe)
    // jsdomはappendChild直後のcontentWindowを非同期にしか用意しないため、明示的にモックする
    Object.defineProperty(iframe, 'contentWindow', { value: { scrollY: 240 }, configurable: true })
    recordHtmlScrollPosition(tab)
    expect(tab.htmlScrollPosition).toBe(240)
  })
})

describe('restoreHtmlScrollPosition', () => {
  it('htmlScrollPositionがnullの場合は何もしない', () => {
    const tab = createTab('html')
    const iframe = document.createElement('iframe')
    tab.containerEl.appendChild(iframe)
    const scrollToSpy = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { value: { scrollTo: scrollToSpy }, configurable: true })

    restoreHtmlScrollPosition(tab)
    iframe.dispatchEvent(new Event('load'))
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('記録済み位置がある場合、load完了後にscrollToを呼び、呼び出し時点でnullへリセットする', () => {
    const tab = createTab('html')
    tab.htmlScrollPosition = 240
    const iframe = document.createElement('iframe')
    tab.containerEl.appendChild(iframe)
    const scrollToSpy = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { value: { scrollTo: scrollToSpy }, configurable: true })

    restoreHtmlScrollPosition(tab)
    expect(tab.htmlScrollPosition).toBeNull()
    expect(scrollToSpy).not.toHaveBeenCalled()

    iframe.dispatchEvent(new Event('load'))
    expect(scrollToSpy).toHaveBeenCalledWith(0, 240)
  })

  it('iframeが存在しない場合は何もしない', () => {
    const tab = createTab('html')
    tab.htmlScrollPosition = 100
    expect(() => restoreHtmlScrollPosition(tab)).not.toThrow()
    expect(tab.htmlScrollPosition).toBeNull()
  })
})
