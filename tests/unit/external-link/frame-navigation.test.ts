import { describe, expect, it } from 'vitest'
import { isInitialFrameLoad } from '../../../src/main/external-link-guard'

describe('isInitialFrameLoad', () => {
  it('フレームのURLが空文字列の場合は初回ロードと判定する', () => {
    expect(isInitialFrameLoad('')).toBe(true)
  })

  it('フレームのURLがabout:blankの場合は初回ロードと判定する', () => {
    expect(isInitialFrameLoad('about:blank')).toBe(true)
  })

  it('フレームのURLがundefinedの場合は初回ロードと判定する', () => {
    expect(isInitialFrameLoad(undefined)).toBe(true)
  })

  it('フレームのURLが既にfile://で読み込み済みの場合は初回ロードではないと判定する（リンククリック等）', () => {
    expect(isInitialFrameLoad('file:///E:/test.html')).toBe(false)
  })

  it('フレームのURLが既にhttps://で読み込み済みの場合は初回ロードではないと判定する', () => {
    expect(isInitialFrameLoad('https://example.com/')).toBe(false)
  })
})
