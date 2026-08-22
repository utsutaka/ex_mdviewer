import { describe, expect, it } from 'vitest'
import { isRawToggleSupported } from '../../../src/renderer/raw-source/render-raw'

describe('isRawToggleSupported', () => {
  it('markdownの場合はtrueを返す', () => {
    expect(isRawToggleSupported('markdown')).toBe(true)
  })

  it('htmlの場合はtrueを返す', () => {
    expect(isRawToggleSupported('html')).toBe(true)
  })

  it('jsonの場合はfalseを返す', () => {
    expect(isRawToggleSupported('json')).toBe(false)
  })

  it('yamlの場合はfalseを返す', () => {
    expect(isRawToggleSupported('yaml')).toBe(false)
  })

  it('xmlの場合はfalseを返す', () => {
    expect(isRawToggleSupported('xml')).toBe(false)
  })

  it('pdfの場合はfalseを返す', () => {
    expect(isRawToggleSupported('pdf')).toBe(false)
  })
})
