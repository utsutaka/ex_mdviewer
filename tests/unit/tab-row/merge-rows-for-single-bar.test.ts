import { describe, expect, it } from 'vitest'
import { mergeRowsForSingleBar } from '../../../src/renderer/tab-bar/components/tab-bar'

describe('mergeRowsForSingleBar', () => {
  it('上段の全タブに続けて下段の全タブを連結する（FR-019）', () => {
    expect(mergeRowsForSingleBar(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('下段が空配列の場合は上段の順序をそのまま返す', () => {
    expect(mergeRowsForSingleBar(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('上段が空配列の場合は下段の順序をそのまま返す', () => {
    expect(mergeRowsForSingleBar([], ['c', 'd'])).toEqual(['c', 'd'])
  })

  it('両方空配列の場合は空配列を返す', () => {
    expect(mergeRowsForSingleBar([], [])).toEqual([])
  })
})
