import { describe, expect, it } from 'vitest'
import { resolveContainerClassName } from '../../../src/renderer/content/tab-container'

describe('resolveContainerClassName', () => {
  it('htmlの場合はdocument-paneに加えて判別用クラスdocument-pane--htmlを返す', () => {
    expect(resolveContainerClassName('html')).toBe('document-pane document-pane--html')
  })

  it('markdownの場合は従来通りdocument-paneのみを返す（非退行）', () => {
    expect(resolveContainerClassName('markdown')).toBe('document-pane')
  })

  it('pdfの場合は従来通りpdf-paneを返す（非退行）', () => {
    expect(resolveContainerClassName('pdf')).toBe('pdf-pane')
  })

  it('json/yaml/xml等その他fileKindの場合は従来通りstructured-treeを返す（非退行）', () => {
    expect(resolveContainerClassName('json')).toBe('structured-tree')
  })
})
