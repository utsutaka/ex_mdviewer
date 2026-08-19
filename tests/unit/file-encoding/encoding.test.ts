import Encoding from 'encoding-japanese'
import { describe, expect, it } from 'vitest'
import { decodeFileBuffer } from '../../../src/main/file-encoding'

function toEncodedBuffer(text: string, to: 'SJIS' | 'EUCJP'): Buffer {
  const unicodeArray = Encoding.stringToCode(text)
  const converted = Encoding.convert(unicodeArray, { to, from: 'UNICODE' })
  return Buffer.from(converted)
}

describe('decodeFileBuffer', () => {
  it('UTF-8のバッファをutf-8として検出しそのままデコードする', () => {
    const buffer = Buffer.from('こんにちは、mdviewer', 'utf-8')
    const result = decodeFileBuffer(buffer)
    expect(result.encodingStatus).toBe('utf-8')
    expect(result.content).toBe('こんにちは、mdviewer')
  })

  it('Shift-JISのバッファをshift-jisとして検出しUTF-8文字列へ変換する', () => {
    const buffer = toEncodedBuffer('日本語のテスト文書', 'SJIS')
    const result = decodeFileBuffer(buffer)
    expect(result.encodingStatus).toBe('shift-jis')
    expect(result.content).toBe('日本語のテスト文書')
  })

  it('EUC-JPのバッファをeuc-jpとして検出しUTF-8文字列へ変換する', () => {
    const buffer = toEncodedBuffer('日本語のテスト文書', 'EUCJP')
    const result = decodeFileBuffer(buffer)
    expect(result.encodingStatus).toBe('euc-jp')
    expect(result.content).toBe('日本語のテスト文書')
  })

  it('いずれのエンコーディングにも該当しないバイト列はunrecognizedとしてベストエフォートでデコードする', () => {
    const buffer = Buffer.from([0x80, 0x81, 0x82, 0x83, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff])
    const result = decodeFileBuffer(buffer)
    expect(result.encodingStatus).toBe('unrecognized')
    expect(typeof result.content).toBe('string')
  })
})
