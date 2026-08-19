import { describe, expect, it } from 'vitest'
import { classifyUrlScheme } from '../../../src/main/external-link-guard'

describe('classifyUrlScheme', () => {
  it('httpスキームをhttpに分類する', () => {
    expect(classifyUrlScheme('http://example.com')).toBe('http')
  })

  it('httpsスキームをhttpに分類する', () => {
    expect(classifyUrlScheme('https://example.com/path?query=1')).toBe('http')
  })

  it('fileスキームをfileに分類する', () => {
    expect(classifyUrlScheme('file:///C:/Windows/System32/cmd.exe')).toBe('file')
  })

  it('mailtoスキームをotherに分類する', () => {
    expect(classifyUrlScheme('mailto:foo@example.com')).toBe('other')
  })

  it('ftpスキームをotherに分類する', () => {
    expect(classifyUrlScheme('ftp://example.com/file.txt')).toBe('other')
  })

  it('不正なURL文字列をotherに分類する', () => {
    expect(classifyUrlScheme('not a url')).toBe('other')
  })
})
