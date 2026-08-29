// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { detectMermaidElements } from '../../../src/renderer/content/markdown/mermaid'

function createContainer(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('detectMermaidElements', () => {
  it('pre.mermaidを検出する', () => {
    const container = createContainer('<pre class="mermaid">graph TD; A-->B;</pre>')
    const result = detectMermaidElements(container)
    expect(result).toHaveLength(1)
    expect(result[0].sourceText).toBe('graph TD; A-->B;')
  })

  it('div.mermaidを検出する', () => {
    const container = createContainer(
      '<div class="mermaid">sequenceDiagram; Alice->>Bob: Hello</div>'
    )
    const result = detectMermaidElements(container)
    expect(result).toHaveLength(1)
    expect(result[0].sourceText).toBe('sequenceDiagram; Alice->>Bob: Hello')
  })

  it('他のクラス名が併記されていてもクラスリスト部分一致で検出する', () => {
    const container = createContainer('<pre class="mermaid theme-dark">graph TD; A-->B;</pre>')
    const result = detectMermaidElements(container)
    expect(result).toHaveLength(1)
  })

  it('大文字小文字が異なるクラス名は検出しない', () => {
    const container = createContainer('<pre class="Mermaid">graph TD; A-->B;</pre>')
    expect(detectMermaidElements(container)).toEqual([])
  })

  it('mermaidクラスを持たない要素は検出しない', () => {
    const container = createContainer('<pre class="language-mermaid">graph TD; A-->B;</pre>')
    expect(detectMermaidElements(container)).toEqual([])
  })

  it('Mermaidブロックが存在しない場合は空配列を返す', () => {
    const container = createContainer('<p>本文のみ</p>')
    expect(detectMermaidElements(container)).toEqual([])
  })

  it('ネストしたタグはテキストのみが抽出される', () => {
    const container = createContainer(
      '<pre class="mermaid"><code>graph TD; A--&gt;B;</code></pre>'
    )
    const result = detectMermaidElements(container)
    expect(result).toHaveLength(1)
    expect(result[0].sourceText).toBe('graph TD; A-->B;')
  })

  it('複数のMermaidブロックをすべて検出する', () => {
    const container = createContainer(
      '<pre class="mermaid">graph TD; A-->B;</pre><div class="mermaid">graph TD; C-->D;</div>'
    )
    expect(detectMermaidElements(container)).toHaveLength(2)
  })
})
