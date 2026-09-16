import { describe, expect, it } from 'vitest'
import { resolveRowSwitchTarget } from '../../../src/renderer/tab-bar/components/tab-bar'

describe('resolveRowSwitchTarget', () => {
  it('下段にフォーカスがあり上段にタブがある場合、上キーで上段を返す', () => {
    expect(resolveRowSwitchTarget('up', 'lower', { upper: 1, lower: 1 })).toBe('upper')
  })

  it('上段にフォーカスがあり下段にタブがある場合、下キーで下段を返す', () => {
    expect(resolveRowSwitchTarget('down', 'upper', { upper: 1, lower: 1 })).toBe('lower')
  })

  it('対象行のタブが0件の場合はnullを返す（FR-013）', () => {
    expect(resolveRowSwitchTarget('down', 'upper', { upper: 1, lower: 0 })).toBeNull()
    expect(resolveRowSwitchTarget('up', 'lower', { upper: 0, lower: 1 })).toBeNull()
  })

  it('対応する方向に段自体が存在しない場合はnullを返す（FR-013a）', () => {
    expect(resolveRowSwitchTarget('up', 'upper', { upper: 1, lower: 1 })).toBeNull()
    expect(resolveRowSwitchTarget('down', 'lower', { upper: 1, lower: 1 })).toBeNull()
  })
})
