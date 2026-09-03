import { describe, expect, it } from 'vitest'
import { buildThemeFallbackCss } from '../../../src/renderer/content/html-view/render-html'

describe('buildThemeFallbackCss', () => {
  it('@layerでラップされたCSSを生成する（HTML自身の指定を優先させるため）', () => {
    const css = buildThemeFallbackCss('light')
    expect(css).toContain('@layer html-view-fallback')
  })

  it('lightテーマではbase.cssのtheme-light相当の色（panel-bg #f5f5f5, fg #1a1a1a）を使う', () => {
    const css = buildThemeFallbackCss('light')
    expect(css).toContain('#f5f5f5')
    expect(css).toContain('#1a1a1a')
  })

  it('darkテーマではbase.cssのtheme-dark相当の色（panel-bg #252526, fg #e0e0e0）を使う', () => {
    const css = buildThemeFallbackCss('dark')
    expect(css).toContain('#252526')
    expect(css).toContain('#e0e0e0')
  })

  it('pre内のcodeは背景を透明にする（015-fix-html-codeblock-bg FR-007の規則を踏襲）', () => {
    const css = buildThemeFallbackCss('light')
    expect(css).toMatch(/pre code\s*{\s*background:\s*none/)
  })
})
