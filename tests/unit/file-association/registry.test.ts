import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

function succeed(): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '', ''))
}

function failWith(stderr: string): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error(stderr), '', stderr))
}

describe('file-association', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('cleanupLegacyFileAssociationはキーが存在する場合、例外を投げず正常終了する', async () => {
    succeed()
    const { cleanupLegacyFileAssociation } = await import('../../../src/main/file-association')
    await expect(cleanupLegacyFileAssociation()).resolves.toBeUndefined()
    expect(execFileMock).toHaveBeenCalled()
    const firstCallArgs = execFileMock.mock.calls[0]
    expect(firstCallArgs[0]).toBe('reg')
  })

  it('cleanupLegacyFileAssociationはキーが存在しない場合も例外を投げず正常終了する（冪等性、FR-007）', async () => {
    failWith('ERROR: The system was unable to find the specified registry key or value.')
    const { cleanupLegacyFileAssociation } = await import('../../../src/main/file-association')
    await expect(cleanupLegacyFileAssociation()).resolves.toBeUndefined()
  })

  it('cleanupLegacyFileAssociationは権限不足等により削除自体に失敗した場合も例外を投げず正常終了する（FR-007）', async () => {
    failWith('ERROR: Access is denied.')
    const { cleanupLegacyFileAssociation } = await import('../../../src/main/file-association')
    await expect(cleanupLegacyFileAssociation()).resolves.toBeUndefined()
  })
})
