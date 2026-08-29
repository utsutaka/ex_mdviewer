// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { extractHeadingsFromDom } from '../../../src/renderer/content/html-view/render-html'

function createContainer(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('extractHeadingsFromDom', () => {
  it('見出しがない場合は空配列を返す', () => {
    const container = createContainer('<p>本文のみ</p>')
    expect(extractHeadingsFromDom(container)).toEqual([])
  })

  it('フラットな見出し構造を階層化する', () => {
    const container = createContainer('<h1>H1</h1><h2>H2</h2><h3>H3</h3>')
    const headings = extractHeadingsFromDom(container)
    expect(headings).toHaveLength(1)
    expect(headings[0].text).toBe('H1')
    expect(headings[0].children).toHaveLength(1)
    expect(headings[0].children[0].text).toBe('H2')
    expect(headings[0].children[0].children).toHaveLength(1)
    expect(headings[0].children[0].children[0].text).toBe('H3')
  })

  it('既存id属性を持つ見出しはそれをanchorIdとして使う', () => {
    const container = createContainer('<h1 id="custom-id">見出し</h1>')
    const headings = extractHeadingsFromDom(container)
    expect(headings[0].anchorId).toBe('custom-id')
    expect(container.querySelector('h1')?.id).toBe('custom-id')
  })

  it('id属性を持たない見出しはgithub-sluggerでIDが生成され、要素にも付与される', () => {
    const container = createContainer('<h1>見出しテキスト</h1>')
    const headings = extractHeadingsFromDom(container)
    expect(headings[0].anchorId).toBeTruthy()
    expect(container.querySelector('h1')?.id).toBe(headings[0].anchorId)
  })

  it('id属性を持たない同一テキストの見出しが複数ある場合、スラッグが重複しない', () => {
    const container = createContainer('<h1>見出し</h1><h1>見出し</h1>')
    const headings = extractHeadingsFromDom(container)
    expect(headings[0].anchorId).not.toBe(headings[1].anchorId)
  })
})
