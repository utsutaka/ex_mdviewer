// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { FileOpenedPayload } from '@shared/types'
import { renderHtmlDocumentInto, scopeStyleContent } from '../../../src/renderer/content/html-view/render-html'
import type { TabRuntime } from '../../../src/renderer/content/main'

function createTab(tabId = 'test-tab'): TabRuntime {
  return {
    tabId,
    filePath: 'test.html',
    containerEl: document.createElement('div'),
    headings: [],
    fileKind: 'html',
    displayMode: 'rendered',
    rawSourceText: ''
  }
}

const noopNotify = (): void => {}

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

describe('scopeStyleContent', () => {
  it('CSSを@scope([data-tab-id=...])でラップする', () => {
    const result = scopeStyleContent('.red{color:red}', 'test-tab')
    expect(result).toContain('@scope([data-tab-id="test-tab"])')
    expect(result).toContain('.red{color:red}')
  })

  it('tabIdにダブルクォートを含む特殊な値でも壊れずJSON文字列として埋め込む', () => {
    const tabId = 'weird"id'
    const result = scopeStyleContent('body{color:blue}', tabId)
    expect(result).toContain(JSON.stringify(tabId))
  })

  it('空文字のCSSを渡しても例外にならない', () => {
    expect(() => scopeStyleContent('', 'test-tab')).not.toThrow()
    expect(scopeStyleContent('', 'test-tab')).toContain('@scope([data-tab-id="test-tab"])')
  })
})

describe('renderHtmlDocumentInto - styleブロックのタブ単位スコープ化', () => {
  it('<style>要素のtextContentが@scopeでラップされる', () => {
    const tab = createTab('tab-a')
    const html = '<style>.red{color:red}</style><p class="red">test</p>'
    renderHtmlDocumentInto(tab, createPayload(html), noopNotify)
    const styleEl = tab.containerEl.querySelector('style')
    expect(styleEl?.textContent).toContain('@scope([data-tab-id="tab-a"])')
    expect(styleEl?.textContent).toContain('.red{color:red}')
  })

  it('複数の<style>要素がそれぞれ独立してラップされる', () => {
    const tab = createTab('tab-b')
    const html = '<head><style>h1{color:green}</style></head><body><style>.blue{color:blue}</style><h1>test</h1></body>'
    renderHtmlDocumentInto(tab, createPayload(html), noopNotify)
    const styleEls = tab.containerEl.querySelectorAll('style')
    expect(styleEls).toHaveLength(2)
    styleEls.forEach((el) => {
      expect(el.textContent).toContain('@scope([data-tab-id="tab-b"])')
    })
    expect(styleEls[0]?.textContent).toContain('h1{color:green}')
    expect(styleEls[1]?.textContent).toContain('.blue{color:blue}')
  })

  it('空の<style>要素でもエラーにならない', () => {
    const tab = createTab('tab-c')
    const html = '<style></style><p>test</p>'
    expect(() => renderHtmlDocumentInto(tab, createPayload(html), noopNotify)).not.toThrow()
  })

  it('<style>ブロックを持たないHTMLではエラーにならず、style要素も生成されない', () => {
    const tab = createTab('tab-d')
    const html = '<p style="color: blue;">test</p>'
    expect(() => renderHtmlDocumentInto(tab, createPayload(html), noopNotify)).not.toThrow()
    expect(tab.containerEl.querySelector('style')).toBeNull()
  })
})

describe('renderHtmlDocumentInto - <body>要素のタグごと移植（FR-002退行修正）', () => {
  it('<body>要素自体がcontainerEl配下にタグとして存在する（innerHTML代入では消失していた）', () => {
    const tab = createTab('tab-e')
    const html = '<html><head><style>body{color:red}</style></head><body><h1>test</h1></body></html>'
    renderHtmlDocumentInto(tab, createPayload(html), noopNotify)
    expect(tab.containerEl.querySelector('body')).not.toBeNull()
  })

  it('<body>要素のstyle属性による指定が保持される', () => {
    const tab = createTab('tab-f')
    const html = '<body style="background: blue;"><p>test</p></body>'
    renderHtmlDocumentInto(tab, createPayload(html), noopNotify)
    const bodyEl = tab.containerEl.querySelector('body')
    expect(bodyEl?.getAttribute('style')).toBe('background: blue;')
  })

  it('SVG内のtitle要素は<body>ごと移植されるため引き続き維持される', () => {
    const tab = createTab('tab-g')
    const html = '<svg width="24" height="24"><title>アイコンの説明</title><circle cx="12" cy="12" r="10" /></svg>'
    renderHtmlDocumentInto(tab, createPayload(html), noopNotify)
    expect(tab.containerEl.querySelector('svg title')).not.toBeNull()
  })

  it('<head>のtitle要素はcontainerElへ移植されない（除去処理なしでFR-003を満たす）', () => {
    const tab = createTab('tab-h')
    const html = '<html><head><title>ページタイトル</title></head><body><h1>本文</h1></body></html>'
    renderHtmlDocumentInto(tab, createPayload(html), noopNotify)
    expect(tab.containerEl.querySelector('title')).toBeNull()
  })
})
