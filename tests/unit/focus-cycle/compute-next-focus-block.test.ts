import { describe, expect, it } from 'vitest'
import { computeNextFocusBlock } from '../../../src/main/focus-cycle'
import type { FocusBlockId } from '@shared/types'

const ALL_VISIBLE: Record<FocusBlockId, boolean> = {
  tabBar: true,
  explorer: true,
  content: true,
  toc: true
}

describe('computeNextFocusBlock', () => {
  it('4塊すべて可視の場合、next方向で固定巡回順序どおりに次の塊を返す', () => {
    expect(computeNextFocusBlock('tabBar', 'next', ALL_VISIBLE)).toBe('explorer')
    expect(computeNextFocusBlock('explorer', 'next', ALL_VISIBLE)).toBe('content')
    expect(computeNextFocusBlock('content', 'next', ALL_VISIBLE)).toBe('toc')
    expect(computeNextFocusBlock('toc', 'next', ALL_VISIBLE)).toBe('tabBar')
  })

  it('4塊すべて可視の場合、prev方向で逆順に前の塊を返す', () => {
    expect(computeNextFocusBlock('tabBar', 'prev', ALL_VISIBLE)).toBe('toc')
    expect(computeNextFocusBlock('toc', 'prev', ALL_VISIBLE)).toBe('content')
    expect(computeNextFocusBlock('content', 'prev', ALL_VISIBLE)).toBe('explorer')
    expect(computeNextFocusBlock('explorer', 'prev', ALL_VISIBLE)).toBe('tabBar')
  })

  it('一部の塊が非可視の場合、その塊をスキップして次の可視な塊を返す（FR-009）', () => {
    const visibility: Record<FocusBlockId, boolean> = { ...ALL_VISIBLE, explorer: false }
    expect(computeNextFocusBlock('tabBar', 'next', visibility)).toBe('content')
  })

  it('複数の塊が同時に非可視の場合でも、可視な塊まで正しくスキップする（explorer・toc非表示、FR-009）', () => {
    const visibility: Record<FocusBlockId, boolean> = { ...ALL_VISIBLE, explorer: false, toc: false }
    expect(computeNextFocusBlock('tabBar', 'next', visibility)).toBe('content')
    expect(computeNextFocusBlock('content', 'next', visibility)).toBe('tabBar')
  })

  it('タブ0件でtabBar・contentが非可視の場合、explorerとtocの間だけを巡回する（FR-009a）', () => {
    const visibility: Record<FocusBlockId, boolean> = { ...ALL_VISIBLE, tabBar: false, content: false }
    expect(computeNextFocusBlock('explorer', 'next', visibility)).toBe('toc')
    expect(computeNextFocusBlock('toc', 'next', visibility)).toBe('explorer')
  })

  it('可視な塊が自分自身のみの場合、nullを返す', () => {
    const visibility: Record<FocusBlockId, boolean> = {
      tabBar: false,
      explorer: true,
      content: false,
      toc: false
    }
    expect(computeNextFocusBlock('explorer', 'next', visibility)).toBeNull()
    expect(computeNextFocusBlock('explorer', 'prev', visibility)).toBeNull()
  })

  it('可視な塊が1つもない場合、nullを返す', () => {
    const visibility: Record<FocusBlockId, boolean> = {
      tabBar: false,
      explorer: false,
      content: false,
      toc: false
    }
    expect(computeNextFocusBlock('tabBar', 'next', visibility)).toBeNull()
  })
})
