// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { FileOpenedPayload } from '@shared/types'
import { renderHtmlDocumentInto } from '../../../src/renderer/html-view/render-html'
import type { TabRuntime } from '../../../src/renderer/main'

function createTab(): TabRuntime {
  return {
    tabId: 'test-tab',
    filePath: 'test.html',
    title: 'test.html',
    containerEl: document.createElement('div'),
    headings: [],
    fileKind: 'html'
  }
}

function createPayload(rawContent: string): FileOpenedPayload {
  return {
    tabId: 'test-tab',
    filePath: 'test.html',
    rawContent,
    encodingStatus: 'utf-8',
    headings: [],
    loadStatus: 'loaded',
    fileKind: 'html',
    yamlDocuments: null,
    structuredParseError: false,
    isEmptyFile: false,
    isInvalidPdf: false
  }
}

describe('renderHtmlDocumentInto - styleブロックの保持', () => {
  it('<head>内のstyleブロックが除去されずに保持される', () => {
    const tab = createTab()
    const html = '<html><head><style>.red{color:red}</style></head><body><p class="red">test</p></body></html>'
    renderHtmlDocumentInto(tab, createPayload(html), false)
    expect(tab.containerEl.querySelector('style')).not.toBeNull()
  })

  it('<body>直下（<head>なし）のstyleブロックも保持される', () => {
    const tab = createTab()
    const html = '<style>.red{color:red}</style><p class="red">test</p>'
    renderHtmlDocumentInto(tab, createPayload(html), false)
    expect(tab.containerEl.querySelector('style')).not.toBeNull()
  })

  it('要素に直接指定されたstyle属性はそのまま残る', () => {
    const tab = createTab()
    const html = '<p style="color: blue;">test</p>'
    renderHtmlDocumentInto(tab, createPayload(html), false)
    const p = tab.containerEl.querySelector('p')
    expect(p?.getAttribute('style')).toBe('color: blue;')
  })

  it('<html>/<head>/<body>を持たない断片HTMLでもエラーにならずstyleが保持される', () => {
    const tab = createTab()
    const html = '<h1>見出し</h1><style>.red{color:red}</style>'
    expect(() => renderHtmlDocumentInto(tab, createPayload(html), false)).not.toThrow()
    expect(tab.containerEl.querySelector('style')).not.toBeNull()
  })
})

describe('renderHtmlDocumentInto - title要素の非表示化とSVG内titleの維持', () => {
  it('<head>内のtitle要素がcontainerEl直下から除去される', () => {
    const tab = createTab()
    const html = '<html><head><title>ページタイトル</title></head><body><h1>本文</h1></body></html>'
    renderHtmlDocumentInto(tab, createPayload(html), false)
    expect(tab.containerEl.querySelector(':scope > title')).toBeNull()
  })

  it('SVG内のtitle要素は除去されず維持される', () => {
    const tab = createTab()
    const html = '<svg width="24" height="24"><title>アイコンの説明</title><circle cx="12" cy="12" r="10" /></svg>'
    renderHtmlDocumentInto(tab, createPayload(html), false)
    expect(tab.containerEl.querySelector('svg title')).not.toBeNull()
  })
})
