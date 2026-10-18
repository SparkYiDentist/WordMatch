export type StorageCategoryId =
  | 'learning'
  | 'personal-packs'
  | 'dictionary'
  | 'media-cache'
  | 'search-history'
  | 'regenerable-cache'
  | 'protected-other'

export type CacheType = 'search' | 'media' | 'temporary' | 'index' | 'all'

export interface StorageCategory {
  id: StorageCategoryId
  label: string
  sizeBytes: number
  itemCount: number
  kind: 'important' | 'cache' | 'bundled' | 'protected'
  note: string
}

export interface CacheItem {
  id: Exclude<CacheType, 'all'>
  label: string
  description: string
  sizeBytes: number
  itemCount: number
}

export interface StorageOverview {
  storageCurrentBytes: number
  storageLimitBytes: number
  storagePercent: number
  localFileBytes: number
  clearableBytes: number
  importantBytes: number
  categories: StorageCategory[]
  cacheItems: CacheItem[]
  calculatedAt: number
  errors: string[]
}

export interface CleanupResult {
  type: CacheType
  success: boolean
  releasedBytes: number
  removedStorageKeys: number
  removedFiles: number
  failures: string[]
  completedAt: number
  overview: StorageOverview
}

type StorageClass = 'learning' | 'personal-packs' | 'settings' | 'search' | 'media' | 'temporary' | 'index' | 'unknown'
type FileClass = 'search' | 'media' | 'temporary' | 'index' | 'unknown'

interface FileEntry {
  path: string
  sizeBytes: number
  category: FileClass
}

interface FileScanResult {
  entries: FileEntry[]
  errors: string[]
}

const LEARNING_KEYS = new Set([
  'wordmatch:v2:profile',
  'wordmatch:v1:profile',
  'wordmatch:v1:lastResult',
  'wordmatch:v1:checkIn',
])

const SETTINGS_KEYS = new Set([
  'wordmatch:v2:settings',
  'wordmatch:v2:ambientSettings',
  'logs',
])

const PERSONAL_PACK_PREFIXES = [
  'wordmatch:v1:personalPack:',
  'wordmatch:v1:personalPacks:',
]

const LEARNING_PREFIXES = [
  'wordmatch:v1:dailyStats:',
]

const CACHE_STORAGE_PREFIXES: Record<Exclude<CacheType, 'all'>, readonly string[]> = {
  search: ['cache:search:'],
  media: ['cache:image:', 'cache:audio:'],
  temporary: ['cache:temporary:'],
  index: ['cache:index:'],
}

const cacheRoot = (): string => `${wx.env.USER_DATA_PATH}/wordmatch-cache`

const normalizePath = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

const containsTraversal = (path: string): boolean => normalizePath(path).split('/').some(part => part === '..')

export const isSafeCachePath = (path: string): boolean => {
  if (!path || path.includes('\u0000') || containsTraversal(path)) return false
  const candidate = normalizePath(path)
  const root = normalizePath(cacheRoot())
  return candidate !== root && candidate.startsWith(`${root}/`)
}

export const classifyStorageKey = (key: string): StorageClass => {
  if (LEARNING_KEYS.has(key) || LEARNING_PREFIXES.some(prefix => key.startsWith(prefix))) return 'learning'
  if (PERSONAL_PACK_PREFIXES.some(prefix => key.startsWith(prefix))) return 'personal-packs'
  if (SETTINGS_KEYS.has(key)) return 'settings'
  if (CACHE_STORAGE_PREFIXES.search.some(prefix => key.startsWith(prefix))) return 'search'
  if (CACHE_STORAGE_PREFIXES.media.some(prefix => key.startsWith(prefix))) return 'media'
  if (CACHE_STORAGE_PREFIXES.temporary.some(prefix => key.startsWith(prefix))) return 'temporary'
  if (CACHE_STORAGE_PREFIXES.index.some(prefix => key.startsWith(prefix))) return 'index'
  return 'unknown'
}

const utf8ByteLength = (value: string): number => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

const storedPayloadSize = (key: string, value: unknown): number => {
  if (value === undefined) return 0
  let serialized = ''
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value)
  } catch (_error) {
    return utf8ByteLength(key)
  }
  return utf8ByteLength(key) + utf8ByteLength(serialized)
}

const readDirectory = (path: string): Promise<string[] | null> => new Promise(resolve => {
  wx.getFileSystemManager().readdir({
    dirPath: path,
    success: result => resolve(result.files),
    fail: () => resolve(null),
  })
})

const readStats = (path: string): Promise<WechatMiniprogram.Stats | null> => new Promise(resolve => {
  wx.getFileSystemManager().stat({
    path,
    success: result => resolve(result.stats as WechatMiniprogram.Stats),
    fail: () => resolve(null),
  })
})

const classifyFile = (path: string): FileClass => {
  const normalized = normalizePath(path)
  const root = normalizePath(cacheRoot())
  const relative = normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : ''
  const first = relative.split('/')[0]
  if (first === 'search') return 'search'
  if (first === 'image' || first === 'audio') return 'media'
  if (first === 'temporary') return 'temporary'
  if (first === 'index') return 'index'
  return 'unknown'
}

const scanDirectory = async (directory: string, entries: FileEntry[], errors: string[]): Promise<void> => {
  const names = await readDirectory(directory)
  if (names === null) {
    errors.push(`无法读取目录：${directory}`)
    return
  }
  for (const name of names) {
    const path = `${normalizePath(directory)}/${name}`
    const stats = await readStats(path)
    if (!stats) {
      errors.push(`无法读取文件信息：${path}`)
      continue
    }
    if (stats.isDirectory()) await scanDirectory(path, entries, errors)
    else if (stats.isFile()) entries.push({ path, sizeBytes: Math.max(0, stats.size), category: classifyFile(path) })
  }
}

const scanUserFiles = async (): Promise<FileScanResult> => {
  const entries: FileEntry[] = []
  const errors: string[] = []
  const names = await readDirectory(wx.env.USER_DATA_PATH)
  if (names === null) return { entries, errors: ['无法读取小程序本地文件目录'] }
  for (const name of names) {
    const path = `${normalizePath(wx.env.USER_DATA_PATH)}/${name}`
    const stats = await readStats(path)
    if (!stats) {
      errors.push(`无法读取文件信息：${name}`)
      continue
    }
    if (stats.isDirectory()) await scanDirectory(path, entries, errors)
    else if (stats.isFile()) entries.push({ path, sizeBytes: Math.max(0, stats.size), category: classifyFile(path) })
  }
  return { entries, errors }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

export const formatBytes = (bytes: number): string => {
  const safe = Math.max(0, bytes)
  if (safe < 1024) return `${safe} B`
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(safe < 10 * 1024 ? 2 : 1)} KB`
  return `${(safe / 1024 / 1024).toFixed(2)} MB`
}

export const getStorageOverview = async (): Promise<StorageOverview> => {
  const errors: string[] = []
  let currentSize = 0
  let limitSize = 0
  let keys: string[] = []
  try {
    const storage = wx.getStorageInfoSync()
    currentSize = Math.max(0, storage.currentSize || 0)
    limitSize = Math.max(0, storage.limitSize || 0)
    keys = Array.isArray(storage.keys) ? storage.keys : []
  } catch (_error) {
    errors.push('无法读取本地 Storage 使用情况')
  }

  const storageSizes: Record<StorageClass, number> = {
    learning: 0,
    'personal-packs': 0,
    settings: 0,
    search: 0,
    media: 0,
    temporary: 0,
    index: 0,
    unknown: 0,
  }
  const storageCounts: Record<StorageClass, number> = {
    learning: 0,
    'personal-packs': 0,
    settings: 0,
    search: 0,
    media: 0,
    temporary: 0,
    index: 0,
    unknown: 0,
  }
  keys.forEach(key => {
    const category = classifyStorageKey(key)
    try {
      storageSizes[category] += storedPayloadSize(key, wx.getStorageSync(key))
      storageCounts[category] += 1
    } catch (_error) {
      errors.push(`无法读取 Storage Key：${key}`)
    }
  })

  const fileScan = await scanUserFiles()
  errors.push(...fileScan.errors)
  const fileSize = (category: FileClass): number => sum(fileScan.entries
    .filter(entry => entry.category === category)
    .map(entry => entry.sizeBytes))
  const fileCount = (category: FileClass): number => fileScan.entries.filter(entry => entry.category === category).length
  const mediaSize = storageSizes.media + fileSize('media')
  const searchSize = storageSizes.search + fileSize('search')
  const regenerableSize = storageSizes.temporary + storageSizes.index + fileSize('temporary') + fileSize('index')
  const importantSize = storageSizes.learning + storageSizes['personal-packs']
  const protectedOtherSize = storageSizes.settings + storageSizes.unknown + fileSize('unknown')

  const categories: StorageCategory[] = [
    { id: 'learning', label: '学习记录', sizeBytes: storageSizes.learning, itemCount: storageCounts.learning, kind: 'important', note: '含错词、关卡进度、学习统计与最近结果' },
    { id: 'personal-packs', label: '个人词包', sizeBytes: storageSizes['personal-packs'], itemCount: storageCounts['personal-packs'], kind: 'important', note: '含自建词包、手动释义与词包学习进度' },
    { id: 'dictionary', label: '本地词典数据', sizeBytes: 0, itemCount: 0, kind: 'bundled', note: '随小程序代码包安装，不计入 Storage 或 USER_DATA_PATH' },
    { id: 'media-cache', label: '图片音频缓存', sizeBytes: mediaSize, itemCount: storageCounts.media + fileCount('media'), kind: 'cache', note: mediaSize ? '仅统计 WordMatch 已登记的可重建媒体缓存' : '当前版本未发现独立图片或音频缓存' },
    { id: 'search-history', label: '搜索历史', sizeBytes: searchSize, itemCount: storageCounts.search + fileCount('search'), kind: 'cache', note: searchSize ? '仅统计已登记的搜索缓存' : '当前版本未保存搜索历史' },
    { id: 'regenerable-cache', label: '其他可清理缓存', sizeBytes: regenerableSize, itemCount: storageCounts.temporary + storageCounts.index + fileCount('temporary') + fileCount('index'), kind: 'cache', note: regenerableSize ? '临时文件与可重新生成的索引' : '当前没有临时文件或可重新生成索引' },
    { id: 'protected-other', label: '其他受保护数据', sizeBytes: protectedOtherSize, itemCount: storageCounts.settings + storageCounts.unknown + fileCount('unknown'), kind: 'protected', note: '设置、调试记录及未知数据默认保护' },
  ]

  const cacheItems: CacheItem[] = [
    { id: 'search', label: '清理搜索历史', description: '删除已登记的搜索记录与临时检索结果', sizeBytes: searchSize, itemCount: storageCounts.search + fileCount('search') },
    { id: 'media', label: '清理图片音频缓存', description: '仅删除可重新获取的已登记媒体文件', sizeBytes: mediaSize, itemCount: storageCounts.media + fileCount('media') },
    { id: 'temporary', label: '清理临时文件', description: '删除 WordMatch 专用临时目录中的文件', sizeBytes: storageSizes.temporary + fileSize('temporary'), itemCount: storageCounts.temporary + fileCount('temporary') },
    { id: 'index', label: '清理可重新生成的索引', description: '不包含个人词包索引与学习记录', sizeBytes: storageSizes.index + fileSize('index'), itemCount: storageCounts.index + fileCount('index') },
  ]
  const storageCurrentBytes = currentSize * 1024
  const storageLimitBytes = limitSize * 1024
  return {
    storageCurrentBytes,
    storageLimitBytes,
    storagePercent: storageLimitBytes ? Math.min(100, Math.round(storageCurrentBytes / storageLimitBytes * 1000) / 10) : 0,
    localFileBytes: sum(fileScan.entries.map(entry => entry.sizeBytes)),
    clearableBytes: searchSize + mediaSize + regenerableSize,
    importantBytes: importantSize,
    categories,
    cacheItems,
    calculatedAt: Date.now(),
    errors,
  }
}

const selectedTypes = (type: CacheType): Array<Exclude<CacheType, 'all'>> => (
  type === 'all' ? ['search', 'media', 'temporary', 'index'] : [type]
)

const removeFile = (path: string): Promise<string | null> => new Promise(resolve => {
  if (!isSafeCachePath(path)) {
    resolve(`已拒绝异常路径：${path}`)
    return
  }
  wx.getFileSystemManager().unlink({
    filePath: path,
    success: () => resolve(null),
    fail: error => resolve(`删除文件失败：${path}（${error.errMsg || '未知错误'}）`),
  })
})

export const clearCache = async (type: CacheType): Promise<CleanupResult> => {
  const before = await getStorageOverview()
  const failures: string[] = []
  let removedStorageKeys = 0
  let removedFiles = 0
  const types = selectedTypes(type)
  let keys: string[] = []
  try {
    const storage = wx.getStorageInfoSync()
    keys = Array.isArray(storage.keys) ? storage.keys : []
  } catch (_error) {
    failures.push('无法读取 Storage Key 列表')
  }

  keys.forEach(key => {
    const category = classifyStorageKey(key)
    if (!types.includes(category as Exclude<CacheType, 'all'>)) return
    try {
      wx.removeStorageSync(key)
      removedStorageKeys += 1
    } catch (_error) {
      failures.push(`删除 Storage Key 失败：${key}`)
    }
  })

  const scan = await scanUserFiles()
  failures.push(...scan.errors.filter(error => !error.includes('无法读取目录')))
  for (const entry of scan.entries) {
    if (!types.includes(entry.category as Exclude<CacheType, 'all'>)) continue
    const failure = await removeFile(entry.path)
    if (failure) failures.push(failure)
    else removedFiles += 1
  }

  const after = await getStorageOverview()
  const beforeMeasured = before.storageCurrentBytes + before.localFileBytes
  const afterMeasured = after.storageCurrentBytes + after.localFileBytes
  return {
    type,
    success: failures.length === 0,
    releasedBytes: Math.max(0, beforeMeasured - afterMeasured),
    removedStorageKeys,
    removedFiles,
    failures,
    completedAt: Date.now(),
    overview: after,
  }
}

export const getProtectedStorageKeys = (): string[] => {
  try {
    return wx.getStorageInfoSync().keys.filter(key => {
      const category = classifyStorageKey(key)
      return category === 'learning' || category === 'personal-packs' || category === 'settings' || category === 'unknown'
    })
  } catch (_error) {
    return []
  }
}
