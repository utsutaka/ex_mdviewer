import { describe, expect, it } from 'vitest'
import { tabIdsFromDomOrder } from '../../../src/renderer/tab-bar/components/tab-bar'

describe('tabIdsFromDomOrder', () => {
  it('DOM上の子要素順どおりにタブID配列を返す', () => {
    const children = [{ tabId: 'a' }, { tabId: 'b' }, { tabId: 'c' }]
    expect(tabIdsFromDomOrder(children)).toEqual(['a', 'b', 'c'])
  })

  it('並び替え後の順序（先頭と末尾が入れ替わった状態）を正しく反映する', () => {
    const children = [{ tabId: 'c' }, { tabId: 'b' }, { tabId: 'a' }]
    expect(tabIdsFromDomOrder(children)).toEqual(['c', 'b', 'a'])
  })

  it('tabIdが未設定（undefined）の要素は除外する', () => {
    const children = [{ tabId: 'a' }, { tabId: undefined }, { tabId: 'b' }]
    expect(tabIdsFromDomOrder(children)).toEqual(['a', 'b'])
  })

  it('空配列の場合は空配列を返す', () => {
    expect(tabIdsFromDomOrder([])).toEqual([])
  })
})
