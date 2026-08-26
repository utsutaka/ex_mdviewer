import { beforeEach, describe, expect, it, vi } from 'vitest'

const existsSyncMock = vi.fn()
const rmSyncMock = vi.fn()
const writeFileSyncMock = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  rmSync: (...args: unknown[]) => rmSyncMock(...args),
  writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args)
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\fake\\userData'
  }
}))

let storeConstructorShouldThrow = false

class FakeStore<T extends Record<string, unknown>> {
  private data: T

  constructor(options: { defaults: T }) {
    if (storeConstructorShouldThrow) {
      throw new Error('construction failed')
    }
    this.data = { ...options.defaults }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key]
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value
  }
}

vi.mock('electron-store', () => ({
  default: FakeStore
}))

async function importStore(): Promise<typeof import('../../../src/main/store')> {
  return import('../../../src/main/store')
}

describe('005-native-menu-save-toggle: 設定保存有無', () => {
  beforeEach(() => {
    vi.resetModules()
    existsSyncMock.mockReset()
    rmSyncMock.mockReset()
    writeFileSyncMock.mockReset()
    storeConstructorShouldThrow = false
  })

  it('isPersistenceEnabledは、config.jsonが存在しない場合falseを返す（FR-011）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { isPersistenceEnabled } = await importStore()
    expect(isPersistenceEnabled()).toBe(false)
  })

  it('isPersistenceEnabledは、config.jsonが存在する場合trueを返す（FR-010）', async () => {
    existsSyncMock.mockReturnValue(true)
    const { isPersistenceEnabled } = await importStore()
    expect(isPersistenceEnabled()).toBe(true)
  })

  it('起動時にOFFの場合、Storeを生成せず組み込みの既定値でセッション状態を初期化する（FR-011）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getWindowState, getAppSettings } = await importStore()
    expect(getWindowState()).toEqual({ width: 1000, height: 800, x: -1, y: -1, isMaximized: false })
    expect(getAppSettings()).toEqual({
      theme: 'light',
      tocVisible: true,
      tocWidth: 220,
      contentWidthMode: 'readable',
      folderHistory: []
    })
  })

  it('enablePersistenceは、OFF→ON時に現在のセッション状態をdefaultsとしてStoreを生成しtrueを返す（FR-008）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { enablePersistence, isPersistenceEnabled, setWindowState, getWindowState } =
      await importStore()
    expect(isPersistenceEnabled()).toBe(false)

    setWindowState({ width: 1234, height: 900, x: 10, y: 20, isMaximized: false })
    const result = enablePersistence()

    expect(result).toBe(true)
    expect(getWindowState()).toEqual({ width: 1234, height: 900, x: 10, y: 20, isMaximized: false })
  })

  it('enablePersistenceは、Storeの生成に失敗した場合falseを返しOFFのまま維持する（FR-012）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { enablePersistence, getWindowState } = await importStore()
    storeConstructorShouldThrow = true

    const result = enablePersistence()

    expect(result).toBe(false)
    // セッション状態は引き続き既定値のまま読み書きできる（OFF継続）
    expect(getWindowState()).toEqual({ width: 1000, height: 800, x: -1, y: -1, isMaximized: false })
  })

  it('disablePersistenceは、ON→OFF時に現在値をセッション状態へコピーしconfig.jsonファイルを削除してtrueを返す（FR-009）', async () => {
    existsSyncMock.mockReturnValue(true)
    const { disablePersistence, setWindowState, getWindowState } = await importStore()

    setWindowState({ width: 1500, height: 1000, x: 5, y: 5, isMaximized: true })
    const result = disablePersistence()

    expect(result).toBe(true)
    // 保存先フォルダ全体ではなくconfig.jsonファイル単体を削除する（Chromiumのキャッシュ等の
    // ファイルロックにより実行中のフォルダ再帰削除が失敗するため、実機検証により判明）
    expect(rmSyncMock).toHaveBeenCalledWith('C:\\fake\\userData\\config.json', {
      force: true
    })
    // 削除後もセッション状態として直前の値を読み書きできる
    expect(getWindowState()).toEqual({ width: 1500, height: 1000, x: 5, y: 5, isMaximized: true })
  })

  it('disablePersistenceは、削除に失敗した場合falseを返しONのまま維持する（FR-012）', async () => {
    existsSyncMock.mockReturnValue(true)
    rmSyncMock.mockImplementation(() => {
      throw new Error('remove failed')
    })
    const { disablePersistence, isPersistenceEnabled } = await importStore()

    const result = disablePersistence()

    expect(result).toBe(false)
    // config.jsonの存在確認は引き続きtrueのまま（削除されていない）
    expect(isPersistenceEnabled()).toBe(true)
  })
})

describe('031-folder-history-menu: フォルダ履歴', () => {
  beforeEach(() => {
    vi.resetModules()
    existsSyncMock.mockReset()
    rmSyncMock.mockReset()
    writeFileSyncMock.mockReset()
    storeConstructorShouldThrow = false
  })

  it('setAppSettingsで設定したfolderHistoryがgetAppSettingsで取得できる（FR-001, FR-002）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings } = await importStore()

    setAppSettings({ ...getAppSettings(), folderHistory: ['C:\\Users\\utsutaka\\Documents'] })

    expect(getAppSettings().folderHistory).toEqual(['C:\\Users\\utsutaka\\Documents'])
  })

  it('enablePersistenceは、OFF→ON時にfolderHistoryを含むセッション状態をdefaultsとしてStoreへ書き出す（FR-009, spec.md Key Entities）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings, enablePersistence, isPersistenceEnabled } =
      await importStore()
    expect(isPersistenceEnabled()).toBe(false)

    setAppSettings({ ...getAppSettings(), folderHistory: ['D:\\Docs'] })
    const result = enablePersistence()

    expect(result).toBe(true)
    expect(getAppSettings().folderHistory).toEqual(['D:\\Docs'])
  })

  it('disablePersistenceは、ON→OFF時にfolderHistoryを含む現在値をセッション状態へコピーする（FR-010, spec.md Key Entities）', async () => {
    existsSyncMock.mockReturnValue(true)
    const { getAppSettings, setAppSettings, disablePersistence } = await importStore()

    setAppSettings({ ...getAppSettings(), folderHistory: ['E:\\Projects'] })
    const result = disablePersistence()

    expect(result).toBe(true)
    expect(rmSyncMock).toHaveBeenCalledWith('C:\\fake\\userData\\config.json', { force: true })
    // 削除後もセッション状態として直前の値（folderHistory含む）を読み書きできる
    expect(getAppSettings().folderHistory).toEqual(['E:\\Projects'])
  })

  it('folderHistoryを持たず旧lastOpenedDirectoryのみを持つ永続化値は、1件のみ移行される（research.md Decision 3）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings } = await importStore()

    // 旧バージョンが残した形状を模した書き込み（AppSettings型にはlastOpenedDirectoryは存在しないため、
    // テスト内でのみ型を緩めてレガシー形状を再現する）
    setAppSettings({
      ...getAppSettings(),
      ...({ lastOpenedDirectory: 'F:\\Legacy', folderHistory: undefined } as unknown as Partial<
        ReturnType<typeof getAppSettings>
      >)
    })

    expect(getAppSettings().folderHistory).toEqual(['F:\\Legacy'])
  })

  it('folderHistoryが既に有効な配列であれば、旧lastOpenedDirectoryが残っていても参照せずそちらを優先する（research.md Decision 3補足）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings } = await importStore()

    setAppSettings({
      ...getAppSettings(),
      folderHistory: ['G:\\New'],
      ...({ lastOpenedDirectory: 'H:\\Old' } as unknown as Partial<ReturnType<typeof getAppSettings>>)
    })

    expect(getAppSettings().folderHistory).toEqual(['G:\\New'])
  })

  it('folderHistoryが配列でない不正な値の場合は空配列として扱う（research.md Decision 2補足、防御的正規化）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings } = await importStore()

    setAppSettings({
      ...getAppSettings(),
      ...({ folderHistory: 'not-an-array' } as unknown as Partial<ReturnType<typeof getAppSettings>>)
    })

    expect(getAppSettings().folderHistory).toEqual([])
  })

  it('folderHistoryが11件以上残っていた場合でも、読み出し時に10件へ切り詰める（FR-003の読み出し側保証）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings } = await importStore()
    const oversized = Array.from({ length: 12 }, (_, i) => `C:\\Folder${i}`)

    setAppSettings({ ...getAppSettings(), folderHistory: oversized })

    expect(getAppSettings().folderHistory).toHaveLength(10)
    expect(getAppSettings().folderHistory).toEqual(oversized.slice(0, 10))
  })
})

describe('013-content-width-toggle: 表示幅モードの永続化', () => {
  beforeEach(() => {
    vi.resetModules()
    existsSyncMock.mockReset()
    rmSyncMock.mockReset()
    writeFileSyncMock.mockReset()
    storeConstructorShouldThrow = false
  })

  it('contentWidthModeの既定値は\'readable\'である（FR-008）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings } = await importStore()

    expect(getAppSettings().contentWidthMode).toBe('readable')
  })

  it('setAppSettingsで設定したcontentWidthModeがgetAppSettingsで取得できる（FR-007）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings } = await importStore()

    setAppSettings({ ...getAppSettings(), contentWidthMode: 'full' })

    expect(getAppSettings().contentWidthMode).toBe('full')
  })

  it('enablePersistenceは、OFF→ON時にcontentWidthModeを含むセッション状態をdefaultsとしてStoreへ書き出す（FR-007）', async () => {
    existsSyncMock.mockReturnValue(false)
    const { getAppSettings, setAppSettings, enablePersistence, isPersistenceEnabled } =
      await importStore()
    expect(isPersistenceEnabled()).toBe(false)

    setAppSettings({ ...getAppSettings(), contentWidthMode: 'full' })
    const result = enablePersistence()

    expect(result).toBe(true)
    expect(getAppSettings().contentWidthMode).toBe('full')
  })

  it('disablePersistenceは、ON→OFF時にcontentWidthModeを含む現在値をセッション状態へコピーする（FR-007）', async () => {
    existsSyncMock.mockReturnValue(true)
    const { getAppSettings, setAppSettings, disablePersistence } = await importStore()

    setAppSettings({ ...getAppSettings(), contentWidthMode: 'full' })
    const result = disablePersistence()

    expect(result).toBe(true)
    expect(rmSyncMock).toHaveBeenCalledWith('C:\\fake\\userData\\config.json', { force: true })
    expect(getAppSettings().contentWidthMode).toBe('full')
  })
})
