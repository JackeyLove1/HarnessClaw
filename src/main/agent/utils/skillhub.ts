import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { resolveSkillsDir } from './paths';

// Default configuration from Python skillhub CLI
const CLI_VERSION = '2026.3.3'
const CLI_USER_AGENT = `skills-store-cli/${CLI_VERSION}`
const DEFAULT_SEARCH_URL = 'https://lightmake.site/api/v1/search'
const DEFAULT_PRIMARY_DOWNLOAD_URL_TEMPLATE =
  'https://lightmake.site/api/v1/download?slug={slug}'
const SKILLHUB_CN_API = 'https://api.skillhub.cn/api/skills'
const LOCKFILE_NAME = '.skills_store_lock.json'

const SKILLS_INSTALL_ROOT = resolveSkillsDir()

export interface SkillSearchResult {
  slug: string
  name: string
  description: string
  summary: string
  version: string
}

export interface SearchResponse {
  query: string
  count: number
  results: SkillSearchResult[]
}

export interface SkillHubCnSkill {
  category: string
  created_at: number
  description: string
  description_zh: string
  downloads: number
  homepage: string
  iconUrl: string | null
  installs: number
  name: string
  ownerName: string
  score: number
  slug: string
  source: string
  stars: number
  tags: string[] | null
  updated_at: number
  version: string
}

export interface SkillHubCnResponse {
  code: number
  data: {
    skills: SkillHubCnSkill[]
    total: number
  }
  message: string
}

export interface ListSkillsResult {
  skills: SkillHubCnSkill[]
  total: number
}

export interface InstallResult {
  success: boolean
  slug: string
  targetDir: string
  version?: string
  error?: string
}

export interface LockfileEntry {
  name: string
  zip_url: string
  source: string
  version: string
}

export interface Lockfile {
  version: number
  skills: Record<string, LockfileEntry>
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function urlparse(urlStr: string): URL {
  return new URL(urlStr)
}

function fetchJson<T>(urlStr: string, timeoutMs = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = urlparse(urlStr)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const params: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': CLI_USER_AGENT,
        Accept: 'application/json'
      }
    }

    const req = lib.request(params, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve(JSON.parse(raw) as T)
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${String(e)}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error(`Request timeout after ${timeoutMs}ms`))
    })

    req.end()
  })
}

function downloadFile(urlStr: string, destPath: string, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = urlparse(urlStr)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const params: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': CLI_USER_AGENT,
        Accept: 'application/zip,application/octet-stream,*/*'
      }
    }

    const req = lib.request(params, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Download failed (${res.statusCode})`))
        return
      }

      const file = fs.createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => {
        file.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })
      file.on('error', reject)
    })

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error(`Download timeout after ${timeoutMs}ms`))
    })

    req.end()
  })
}

function safeExtractZip(zipPath: string, targetDir: string): void {
  // Use PowerShell on Windows, unzip on Unix
  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'pipe' }
    )
  } else {
    execSync(`unzip -o "${zipPath}" -d "${targetDir}"`, { stdio: 'pipe' })
  }
}

// ---------------------------------------------------------------------------
// URL template helpers
// ---------------------------------------------------------------------------

function fillSlugTemplate(template: string, slug: string): string {
  if (!template) return ''
  return template.replace('{slug}', encodeURIComponent(slug))
}

// ---------------------------------------------------------------------------
// Lockfile management
// ---------------------------------------------------------------------------

function loadLockfile(installRoot: string): Lockfile {
  const lockPath = path.join(installRoot, LOCKFILE_NAME)
  if (!fs.existsSync(lockPath)) {
    return { version: 1, skills: {} }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    if (!raw || typeof raw !== 'object') return { version: 1, skills: {} }
    if (!raw.skills || typeof raw.skills !== 'object') {
      raw.skills = {}
    }
    return raw as Lockfile
  } catch {
    return { version: 1, skills: {} }
  }
}

function saveLockfile(installRoot: string, lock: Lockfile): void {
  const lockPath = path.join(installRoot, LOCKFILE_NAME)
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search for skills by keyword using the remote search API.
 */
export async function searchSkills(
  query: string,
  options: {
    searchUrl?: string
    limit?: number
    timeoutMs?: number
  } = {}
): Promise<SearchResponse> {
  const searchUrl = options.searchUrl || DEFAULT_SEARCH_URL
  const limit = options.limit || 20
  const timeoutMs = options.timeoutMs || 6000

  const parsed = urlparse(searchUrl)
  parsed.searchParams.set('q', query)
  parsed.searchParams.set('limit', String(limit))

  const results = await fetchJson<{ results?: SkillSearchResult[] }>(
    parsed.toString(),
    timeoutMs
  )

  const skillsList = results.results || []
  return {
    query,
    count: skillsList.length,
    results: skillsList.slice(0, limit)
  }
}

/**
 * List skills from skillhub.cn API with pagination and filtering.
 */
export async function listSkills(
  page: number = 1,
  pageSize: number = 24,
  options: {
    category?: string
    keyword?: string
    sortBy?: string
    order?: string
    timeoutMs?: number
  } = {}
): Promise<ListSkillsResult> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize)
  })
  if (options.category) {
    params.set('category', options.category)
  }
  if (options.keyword) {
    params.set('keyword', options.keyword)
  }
  if (options.sortBy) {
    params.set('sortBy', options.sortBy)
  }
  if (options.order) {
    params.set('order', options.order)
  }
  const apiUrl = `${SKILLHUB_CN_API}?${params.toString()}`
  // console.log(`[skillhub] Listing skills: ${apiUrl}`)
  const response = await fetchJson<SkillHubCnResponse>(apiUrl, options.timeoutMs ?? 15000)
  // console.log("resp： ", response)

  if (response.code !== 0) {
    throw new Error(`API error: ${response.message}`)
  }

  return {
    skills: response.data.skills,
    total: response.data.total
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Install a skill by slug from the skillhub registry.
 */
export async function installSkill(
  slug: string,
  options: {
    installRoot?: string
    force?: boolean
    primaryDownloadUrlTemplate?: string
    searchUrl?: string
    searchLimit?: number
    searchTimeoutMs?: number
  } = {}
): Promise<InstallResult> {
  const installRoot = options.installRoot || SKILLS_INSTALL_ROOT
  const force = options.force || false
  const primaryDownloadUrlTemplate =
    options.primaryDownloadUrlTemplate || DEFAULT_PRIMARY_DOWNLOAD_URL_TEMPLATE

  const targetDir = path.join(installRoot, slug)

  // Check if already installed
  if (fs.existsSync(targetDir) && !force) {
    return {
      success: false,
      slug,
      targetDir,
      error: `Skill already installed at ${targetDir}. Use force=true to overwrite.`
    }
  }

  // First, try to find the skill via search to get metadata
  let skillMeta: SkillSearchResult = {
    slug,
    name: slug,
    description: '',
    summary: '',
    version: ''
  }

  try {
    const searchResult = await searchSkills(slug, {
      searchUrl: options.searchUrl || DEFAULT_SEARCH_URL,
      limit: options.searchLimit || 20,
      timeoutMs: options.searchTimeoutMs || 6000
    })

    const exactMatch = searchResult.results.find(
      (s) => s.slug.toLowerCase() === slug.toLowerCase()
    )
    if (exactMatch) {
      skillMeta = exactMatch
    }
  } catch {
    // Continue with basic metadata if search fails
  }

  // Build download URL
  const zipUrl = fillSlugTemplate(primaryDownloadUrlTemplate, slug)
  if (!zipUrl) {
    return {
      success: false,
      slug,
      targetDir,
      error: 'Primary download URL template resolved to empty URL'
    }
  }

  // Create temp directory for download
  const tmpDir = path.join(os.tmpdir(), `skillhub-install-${Date.now()}`)
  const zipPath = path.join(tmpDir, `${slug}.zip`)

  try {
    fs.mkdirSync(tmpDir, { recursive: true })

    // Download the skill zip
    console.log(`[skillhub] Downloading: ${zipUrl}`)
    await downloadFile(zipUrl, zipPath)

    // Extract to stage directory
    const stageDir = path.join(tmpDir, 'stage')
    fs.mkdirSync(stageDir, { recursive: true })

    try {
      safeExtractZip(zipPath, stageDir)
    } catch (e) {
      return {
        success: false,
        slug,
        targetDir,
        error: `Failed to extract zip: ${String(e)}`
      }
    }

    // Remove existing target if force
    if (fs.existsSync(targetDir)) {
      if (force) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      } else {
        return {
          success: false,
          slug,
          targetDir,
          error: `Target exists: ${targetDir}. Use force=true to overwrite.`
        }
      }
    }

    // Move stage to target
    fs.mkdirSync(path.dirname(targetDir), { recursive: true })
    fs.renameSync(stageDir, targetDir)

    // Update lockfile
    const lock = loadLockfile(installRoot)
    lock.skills[slug] = {
      name: skillMeta.name,
      zip_url: zipUrl,
      source: 'skillhub',
      version: skillMeta.version || ''
    }
    saveLockfile(installRoot, lock)

    return {
      success: true,
      slug,
      targetDir,
      version: skillMeta.version
    }
  } catch (e) {
    return {
      success: false,
      slug,
      targetDir,
      error: String(e)
    }
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// List installed skills
// ---------------------------------------------------------------------------

/**
 * List all installed skills from the lockfile.
 */
export function listInstalledSkills(
  installRoot?: string
): { slug: string; version: string; name: string }[] {
  const root = installRoot || SKILLS_INSTALL_ROOT
  const lock = loadLockfile(root)
  return Object.entries(lock.skills).map(([slug, meta]) => ({
    slug,
    version: meta.version || '',
    name: meta.name || slug
  }))
}
