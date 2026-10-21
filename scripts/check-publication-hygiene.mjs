/**
 * Publication hygiene guard.
 *
 * A public repository has to be safe to publish and has to stay that way. The
 * three regressions that were found in the canonical tree are the reason this
 * script exists:
 *
 *   1. `.gitignore` was replaced with a generic Vite stub, which dropped every
 *      rule that keeps a database, an environment file or a key out of a
 *      commit.
 *   2. `package.json` lost its `engines` field, and lost a dependency that
 *      two committed scripts still import - so a clean `npm ci` could not
 *      resolve them, and CI stayed green because CI does not run those
 *      scripts.
 *   3. The README's stated Node requirement drifted from the real one, so
 *      `npm run test` was advertised on a version that cannot run it.
 *
 * None of that is caught by a test. This script is the check for it, and it
 * runs in CI on every pull request.
 *
 * Usage: node scripts/check-publication-hygiene.mjs
 * Exits 0 when everything is in order, 1 with a report when it is not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

/** Directories that are build output or dependency trees, never source. */
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'dist-ssr',
    'coverage',
    'artifacts',
    'target',
    '.git',
    '.vite',
])

/**
 * Ignore rules a public repository must carry. Each one exists because
 * something that must never be committed looks exactly like it.
 */
const REQUIRED_IGNORES = [
    ['node_modules', 'dependencies'],
    ['dist', 'build output'],
    ['coverage', 'test output'],
    ['artifacts', 'local check output'],
    ['.env', 'environment files with secrets'],
    ['.env.*', 'environment files with secrets'],
    ['*.local', 'local overrides'],
    ['*.db', 'local databases - the books'],
    ['*.db-journal', 'local database journals'],
    ['*.db-wal', 'local database write-ahead logs'],
    ['*.db-shm', 'local database shared memory'],
    ['*.sqlite', 'local databases'],
    ['*.sqlite3', 'local databases'],
    ['*.bak', 'database and export backups'],
    ['*.backup', 'database and export backups'],
    ['*.pem', 'keys and certificates'],
    ['*.key', 'keys and certificates'],
    ['*.p12', 'keys and certificates'],
    ['*.pfx', 'keys and certificates'],
    ['*.jks', 'keys and certificates'],
    ['*.keystore', 'keys and certificates'],
    ['*.tsbuildinfo', 'build caches'],
    ['src-tauri/target', 'the Rust build directory'],
    ['src-tauri/gen/schemas', 'generated Tauri schemas'],
    ['tests/*.rs', 'a stray Rust file in the Vitest directory; the Rust tests live in src-tauri/tests/'],
    ['*.log', 'logs'],
]

/** Files that must never exist in a published tree, nor be tracked. */
const SENSITIVE_FILE = [
    /\.env(\..*)?$/i,
    /\.(db|db-journal|db-wal|db-shm|sqlite|sqlite3|bak|backup)$/i,
    /\.(pem|key|p12|pfx|jks|keystore)$/i,
]

/** Source files whose bare imports must be declared as dependencies. */
const SCANNED_EXTENSIONS = new Set(['.mjs', '.js', '.ts', '.tsx', '.vue'])

const failures = []
const fail = (check, message) => failures.push({ check, message })

// ---------------------------------------------------------------------------
// 1. The ignore rules
// ---------------------------------------------------------------------------
function checkIgnoreRules() {
    const ignorePath = path.join(ROOT, '.gitignore')
    if (!existsSync(ignorePath)) {
        fail('ignore rules', 'there is no .gitignore')
        return
    }
    const ignore = readFileSync(ignorePath, 'utf8')
    const lines = ignore.split('\n').map((line) => line.trim())
    for (const [pattern, why] of REQUIRED_IGNORES) {
        if (!lines.includes(pattern)) {
            fail('ignore rules', `".gitignore" is missing "${pattern}" (${why})`)
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Every bare import is a declared dependency
// ---------------------------------------------------------------------------
function collectSources(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue
            collectSources(path.join(dir, entry.name), out)
        } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(path.join(dir, entry.name))
        }
    }
    return out
}

function packageName(specifier) {
    if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
    return specifier.split('/')[0]
}

function checkDeclaredDependencies() {
    const manifestPath = path.join(ROOT, 'package.json')
    if (!existsSync(manifestPath)) {
        fail('declared dependencies', 'there is no package.json')
        return
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const declared = new Set([
        ...Object.keys(manifest.dependencies || {}),
        ...Object.keys(manifest.devDependencies || {}),
        ...Object.keys(manifest.optionalDependencies || {}),
    ])
    const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

    for (const file of collectSources(ROOT)) {
        const source = readFileSync(file, 'utf8')
        const specifiers = [
            ...source.matchAll(/(?:^|\n)\s*import\s[^'"\n]*from\s*['"]([^'"]+)['"]/g),
            ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g),
            ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
            ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
        ].map((m) => m[1])

        for (const specifier of specifiers) {
            if (specifier.startsWith('.') || specifier.startsWith('/')) continue
            if (specifier.startsWith('@/') || specifier.startsWith('~/')) continue
            if (specifier.startsWith('node:')) continue
            if (specifier.startsWith('virtual:') || specifier.startsWith('vite:')) continue
            if (builtins.has(specifier)) continue
            const name = packageName(specifier)
            if (!declared.has(name)) {
                fail(
                    'declared dependencies',
                    `${path.relative(ROOT, file)} imports "${name}", which is not in package.json`,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Nothing sensitive is in the tree, and nothing sensitive is tracked
// ---------------------------------------------------------------------------
function checkNoSensitiveFiles() {
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                if (SKIP_DIRS.has(entry.name)) continue
                walk(full)
            } else if (entry.isFile()) {
                if (SENSITIVE_FILE.some((pattern) => pattern.test(entry.name))) {
                    fail('sensitive files', `${path.relative(ROOT, full)} must not be in a published tree`)
                }
            }
        }
    }
    walk(ROOT)

    if (!existsSync(path.join(ROOT, '.git'))) return
    let tracked = []
    try {
        tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
            .split('\n')
            .filter(Boolean)
    } catch {
        return
    }
    for (const file of tracked) {
        if (SENSITIVE_FILE.some((pattern) => pattern.test(file))) {
            fail('sensitive files', `${file} is tracked by git`)
        }
        const first = file.split('/')[0]
        if (SKIP_DIRS.has(first) && first !== '.git') {
            fail('sensitive files', `${file} is tracked by git but lives in ${first}`)
        }
    }
}

// ---------------------------------------------------------------------------
// 4. The stated Node requirement matches the declared one
// ---------------------------------------------------------------------------
function checkNodeRequirement() {
    const manifestPath = path.join(ROOT, 'package.json')
    const readmePath = path.join(ROOT, 'README.md')
    if (!existsSync(manifestPath) || !existsSync(readmePath)) return

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const engines = manifest.engines && manifest.engines.node
    if (!engines) {
        fail('node requirement', 'package.json has no engines.node, so the Node floor is undeclared')
        return
    }

    const versions = [...engines.matchAll(/(\d+)\.(\d+)(?:\.(\d+))?/g)].map((m) => ({
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3] || 0),
    }))
    if (!versions.length) return
    const floor = versions.reduce((lowest, v) =>
        v.major !== lowest.major ? (v.major < lowest.major ? v : lowest)
            : v.minor !== lowest.minor ? (v.minor < lowest.minor ? v : lowest)
                : (v.patch < lowest.patch ? v : lowest),
    )
    const wanted = `Node ${floor.major}.${floor.minor}`
    const readme = readFileSync(readmePath, 'utf8')
    if (!readme.includes(wanted)) {
        fail(
            'node requirement',
            `package.json requires "${engines}" but the README does not say "${wanted}"`,
        )
    }
}

checkIgnoreRules()
checkDeclaredDependencies()
checkNoSensitiveFiles()
checkNodeRequirement()

if (failures.length) {
    console.error('publication hygiene: FAILED\n')
    for (const { check, message } of failures) {
        console.error(`  [${check}] ${message}`)
    }
    console.error(`\n${failures.length} problem(s). A public repository has to be safe to publish.`)
    process.exit(1)
}

console.log('publication hygiene: OK')
console.log('  ignore rules     : every required rule is present')
console.log('  dependencies     : every bare import is declared')
console.log('  sensitive files  : none present, none tracked')
console.log('  node requirement : README and package.json agree')
