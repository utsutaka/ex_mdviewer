/**
 * 指定フォルダのnode_modulesに含まれる全パッケージについて、名前・バージョン・
 * ライセンス種別・ライセンス全文を集め、THIRD_PARTY_NOTICES.txt を生成する。
 *
 * 使い方: node scripts/generate-third-party-notices.mjs <対象フォルダ> [出力ファイル]
 *   対象フォルダ: node_modules を含むフォルダ（配布用ステージングフォルダを想定）
 *   出力ファイル: 省略時は <対象フォルダ>/THIRD_PARTY_NOTICES.txt
 *
 * 配布ZIPにnode_modulesを同梱しない構成へ変えても、MIT/BSD/ISC等が求める
 * 著作権表示・ライセンス文の保持を満たせるようにするためのもの。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const LICENSE_FILE_PATTERN = /^(un)?(licen[sc]e|copying|notice)([-_.].*)?$/i

/** package.json の license 欄（文字列・旧形式のオブジェクト・配列）を文字列に正規化する */
function normalizeLicense(pkg) {
    const raw = pkg.license ?? pkg.licenses
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw)) {
        return raw.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean).join(' OR ')
    }
    if (raw && typeof raw === 'object' && raw.type) return raw.type
    return '(package.jsonに記載なし)'
}

/** パッケージ直下のライセンス関連ファイルを読み、全文を連結して返す */
function readLicenseTexts(pkgDir) {
    const texts = []
    for (const name of readdirSync(pkgDir)) {
        if (!LICENSE_FILE_PATTERN.test(name)) continue
        const filePath = resolve(pkgDir, name)
        try {
            if (!statSync(filePath).isFile()) continue
            texts.push(readFileSync(filePath, 'utf-8').trim())
        } catch (error) {
            // 1ファイルの読み込み失敗で全体を止めず、欠落を明示して続行する
            texts.push(`(${name} を読み込めませんでした: ${error.message})`)
        }
    }
    return texts
}

/** node_modules を再帰的に走査し、パッケージ情報を集める（name@version で重複排除） */
function collectPackages(nodeModulesDir, found, warnings) {
    if (!existsSync(nodeModulesDir)) return
    for (const entry of readdirSync(nodeModulesDir)) {
        if (entry === '.bin' || entry === '.package-lock.json') continue
        const entryPath = resolve(nodeModulesDir, entry)
        // スコープ付き(@scope/name)は一段下にパッケージがある
        const pkgDirs = entry.startsWith('@')
            ? readdirSync(entryPath).map((n) => resolve(entryPath, n))
            : [entryPath]
        for (const pkgDir of pkgDirs) {
            const pkgJsonPath = resolve(pkgDir, 'package.json')
            if (!existsSync(pkgJsonPath)) continue
            try {
                const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
                if (pkg.name && pkg.version) {
                    const key = `${pkg.name}@${pkg.version}`
                    if (!found.has(key)) {
                        const texts = readLicenseTexts(pkgDir)
                        if (texts.length === 0) warnings.push(`${key}: ライセンスファイルが見つかりません`)
                        found.set(key, {
                            name: pkg.name,
                            version: pkg.version,
                            license: normalizeLicense(pkg),
                            homepage: pkg.homepage ?? pkg.repository?.url ?? pkg.repository ?? '',
                            texts
                        })
                    }
                }
            } catch (error) {
                warnings.push(`${pkgJsonPath}: 解析に失敗しました (${error.message})`)
            }
            collectPackages(resolve(pkgDir, 'node_modules'), found, warnings)
        }
    }
}

/** 通知文書を生成し、outFile へ書き出す。警告の配列を返す */
export function generateThirdPartyNotices(targetDir, outFile) {
    const found = new Map()
    const warnings = []
    collectPackages(resolve(targetDir, 'node_modules'), found, warnings)
    if (found.size === 0) {
        throw new Error(`${targetDir} の node_modules からパッケージを検出できませんでした`)
    }

    const sorted = [...found.values()].sort((a, b) =>
        `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)
    )
    const separator = '='.repeat(72)
    const lines = [
        'THIRD PARTY NOTICES',
        '',
        'このソフトウェアには、以下のオープンソースソフトウェアが含まれています。',
        '各パッケージのライセンス条件は、それぞれの全文に従います。',
        '',
        'なお、Electronに同梱されるChromium等のライセンスは、',
        'node_modules/electron/dist/LICENSES.chromium.html を参照してください。',
        '',
        `パッケージ数: ${sorted.length}`,
        ''
    ]
    for (const p of sorted) {
        lines.push(separator, `${p.name} ${p.version}`, `ライセンス: ${p.license}`)
        if (p.homepage) lines.push(`URL: ${p.homepage}`)
        lines.push('')
        lines.push(p.texts.length > 0 ? p.texts.join('\n\n---\n\n') : '(ライセンス全文は同梱されていません)')
        lines.push('')
    }
    writeFileSync(outFile, lines.join('\n'), 'utf-8')
    return warnings
}

// 直接実行された場合のみCLIとして動作する（pack.mjsからimportされる場合は動かさない）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const targetDir = process.argv[2]
    if (!targetDir) {
        console.error('使い方: node scripts/generate-third-party-notices.mjs <対象フォルダ> [出力ファイル]')
        process.exit(1)
    }
    const outFile = process.argv[3] ?? resolve(targetDir, 'THIRD_PARTY_NOTICES.txt')
    try {
        const warnings = generateThirdPartyNotices(targetDir, outFile)
        warnings.forEach((w) => console.warn(`警告: ${w}`))
        console.log(`生成しました: ${outFile}`)
    } catch (error) {
        console.error(`生成に失敗しました: ${error.message}`)
        process.exit(1)
    }
}
