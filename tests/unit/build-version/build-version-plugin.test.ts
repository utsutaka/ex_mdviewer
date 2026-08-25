import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args)
}))

describe('build-version-plugin', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset()
  })

  describe('isGitAvailable', () => {
    it('git rev-parseが成功しtrueを返す場合、trueを返す', async () => {
      execFileSyncMock.mockReturnValue('true\n')
      const { isGitAvailable } = await import('../../../scripts/vite-plugins/build-version-plugin')
      expect(isGitAvailable('/repo')).toBe(true)
    })

    it('git rev-parseの実行が失敗した場合、falseを返す（FR-007）', async () => {
      execFileSyncMock.mockImplementation(() => {
        throw new Error('not a git repository')
      })
      const { isGitAvailable } = await import('../../../scripts/vite-plugins/build-version-plugin')
      expect(isGitAvailable('/repo')).toBe(false)
    })
  })

  describe('getCommitTimestamp', () => {
    it('git logの標準出力をそのままトリムして返す（FR-005）', async () => {
      execFileSyncMock.mockReturnValue('20260825-120000\n')
      const { getCommitTimestamp } = await import('../../../scripts/vite-plugins/build-version-plugin')
      expect(getCommitTimestamp('/repo')).toBe('20260825-120000')
    })

    it('同一コミットに対する呼び出しは常に同一の値を返す（FR-006: 再現性）', async () => {
      execFileSyncMock.mockReturnValue('20260825-120000\n')
      const { getCommitTimestamp } = await import('../../../scripts/vite-plugins/build-version-plugin')
      const first = getCommitTimestamp('/repo')
      const second = getCommitTimestamp('/repo')
      expect(first).toBe(second)
    })
  })

  describe('buildFallbackVersion', () => {
    it('YYYYMMDD-hhmmss+unofficial形式で、各要素がゼロ埋めされる（FR-004, FR-007）', async () => {
      const { buildFallbackVersion } = await import('../../../scripts/vite-plugins/build-version-plugin')
      const fixedDate = new Date(2026, 0, 5, 9, 3, 7)
      expect(buildFallbackVersion(fixedDate)).toBe('20260105-090307+unofficial')
    })
  })

  describe('resolveBuildVersion', () => {
    it('gitのコミット履歴が利用可能な場合、非公式マーカーなしでコミット日時を返す（FR-005, US3 Acceptance Scenario 2）', async () => {
      execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('--is-inside-work-tree')) {
          return 'true\n'
        }
        return '20260825-120000\n'
      })
      const { resolveBuildVersion } = await import('../../../scripts/vite-plugins/build-version-plugin')
      const version = resolveBuildVersion('/repo')
      expect(version).toBe('20260825-120000')
      expect(version).not.toMatch(/\+unofficial$/)
    })

    it('gitが利用不可の場合、非公式マーカー付きのフォールバック値を返す（FR-007, US3 Acceptance Scenario 1）', async () => {
      execFileSyncMock.mockImplementation(() => {
        throw new Error('git not found')
      })
      const { resolveBuildVersion } = await import('../../../scripts/vite-plugins/build-version-plugin')
      const version = resolveBuildVersion('/repo')
      expect(version).toMatch(/^\d{8}-\d{6}\+unofficial$/)
    })

    it('gitは利用可能だがコミット取得に予期しない理由で失敗した場合も、非公式マーカー付きのフォールバック値を返す（FR-009）', async () => {
      execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('--is-inside-work-tree')) {
          return 'true\n'
        }
        throw new Error('unexpected failure')
      })
      const { resolveBuildVersion } = await import('../../../scripts/vite-plugins/build-version-plugin')
      const version = resolveBuildVersion('/repo')
      expect(version).toMatch(/^\d{8}-\d{6}\+unofficial$/)
    })
  })
})
