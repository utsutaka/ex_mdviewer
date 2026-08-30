import { describe, expect, it } from 'vitest'
import { isTocSupported } from '../../../src/shared/file-kind'

describe('isTocSupported', () => {
  it('markdownの場合はtrueを返す', () => {
    expect(isTocSupported('markdown')).toBe(true)
  })

  it('htmlの場合はtrueを返す', () => {
    expect(isTocSupported('html')).toBe(true)
  })

  it('jsonの場合はfalseを返す', () => {
    expect(isTocSupported('json')).toBe(false)
  })

  it('yamlの場合はfalseを返す', () => {
    expect(isTocSupported('yaml')).toBe(false)
  })

  it('xmlの場合はfalseを返す', () => {
    expect(isTocSupported('xml')).toBe(false)
  })

  it('pdfの場合はfalseを返す', () => {
    expect(isTocSupported('pdf')).toBe(false)
  })
})
