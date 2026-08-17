import Encoding from 'encoding-japanese'
import type { EncodingStatus } from '@shared/types'

export interface DecodedContent {
  content: string
  encodingStatus: EncodingStatus
}

/**
 * ファイルのエンコーディングを自動検出し、UTF-8文字列へ変換する（FR-016）。
 * UTF-8/Shift-JIS/EUC-JP以外（BINARY判定・未確定等）はunrecognizedとし、
 * ベストエフォートでUTF-8として解釈を試みる。
 */
export function decodeFileBuffer(buffer: Buffer): DecodedContent {
  const detected = Encoding.detect(buffer)

  if (detected === 'UTF8' || detected === 'ASCII') {
    return { content: buffer.toString('utf-8'), encodingStatus: 'utf-8' }
  }

  if (detected === 'SJIS') {
    const converted = Encoding.convert(buffer, { to: 'UNICODE', from: 'SJIS' })
    return { content: Encoding.codeToString(converted), encodingStatus: 'shift-jis' }
  }

  if (detected === 'EUCJP') {
    const converted = Encoding.convert(buffer, { to: 'UNICODE', from: 'EUCJP' })
    return { content: Encoding.codeToString(converted), encodingStatus: 'euc-jp' }
  }

  return { content: buffer.toString('utf-8'), encodingStatus: 'unrecognized' }
}
