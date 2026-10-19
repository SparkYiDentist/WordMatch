import { ambientAudioService } from './ambient-audio-service'

const WORD_AUDIO_BASE_URL = 'https://raw.githubusercontent.com/SparkYiDentist/WordMatch/main/remote-assets/word-audio'
const WORD_AUDIO_CACHE_VERSION = 'v1'

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

const rotateRight = (value: number, count: number): number => (value >>> count) | (value << (32 - count))

const utf8Bytes = (value: string): number[] => {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index)
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f))
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f))
        index += 1
      } else bytes.push(0xef, 0xbf, 0xbd)
    } else bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return bytes
}

export const sha256Hex = (value: string): string => {
  const bytes = utf8Bytes(value)
  const bitLength = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff)
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff)

  const hash = [...SHA256_INITIAL]
  const schedule = new Array<number>(64)
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4
      schedule[index] = ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3)
      const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10)
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const upperSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (h + upperSigma1 + choice + SHA256_CONSTANTS[index] + schedule[index]) >>> 0
      const upperSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (upperSigma0 + majority) >>> 0
      h = g; g = f; f = e; e = (d + temporary1) >>> 0
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}

export const normalizeAudioWord = (word: string): string => word.trim().toLowerCase()

export const getWordAudioAsset = (word: string): { key: string; remoteUrl: string } | null => {
  const normalized = normalizeAudioWord(word)
  if (!normalized) return null
  const key = sha256Hex(normalized).slice(0, 24)
  return { key, remoteUrl: `${WORD_AUDIO_BASE_URL}/audio/${key.slice(0, 2)}/${key}.mp3` }
}

const cacheDirectory = (): string => `${wx.env.USER_DATA_PATH}/wordmatch-cache/audio/words-${WORD_AUDIO_CACHE_VERSION}`
const cachePath = (key: string): string => `${cacheDirectory()}/${key}.mp3`
const pendingDownloads: Record<string, Promise<string> | undefined> = {}
const unavailableWords = new Set<string>()

const fileExists = (path: string): boolean => {
  try { wx.getFileSystemManager().accessSync(path); return true } catch (_error) { return false }
}

const removeFile = (path: string): void => {
  try { wx.getFileSystemManager().unlinkSync(path) } catch (_error) { /* Best effort. */ }
}

const resolveAudioSource = (word: string): Promise<string> => {
  const asset = getWordAudioAsset(word)
  if (!asset || unavailableWords.has(asset.key)) return Promise.reject(new Error('AUDIO_NOT_FOUND'))
  const destination = cachePath(asset.key)
  if (fileExists(destination)) return Promise.resolve(destination)
  const pending = pendingDownloads[asset.key]
  if (pending) return pending

  const download = new Promise<string>((resolve, reject) => {
    try {
      const fileSystem = wx.getFileSystemManager()
      try { fileSystem.accessSync(cacheDirectory()) } catch (_error) { fileSystem.mkdirSync(cacheDirectory(), true) }
      wx.downloadFile({
        url: asset.remoteUrl,
        filePath: destination,
        timeout: 30000,
        success: result => {
          if (result.statusCode >= 200 && result.statusCode < 300) resolve(destination)
          else {
            removeFile(destination)
            if (result.statusCode === 404) unavailableWords.add(asset.key)
            reject(new Error(result.statusCode === 404 ? 'AUDIO_NOT_FOUND' : `HTTP_${result.statusCode}`))
          }
        },
        fail: error => {
          removeFile(destination)
          reject(new Error(error.errMsg || 'DOWNLOAD_FAILED'))
        },
      })
    } catch (error) { reject(error) }
  }).finally(() => { delete pendingDownloads[asset.key] })
  pendingDownloads[asset.key] = download
  return download
}

class WordAudioService {
  private context: WechatMiniprogram.InnerAudioContext | null = null
  private requestId = 0
  private activePath = ''

  private readonly finish = (): void => {
    this.activePath = ''
    ambientAudioService.restoreAfterSpeech()
  }

  private readonly handleError = (): void => {
    if (this.activePath) removeFile(this.activePath)
    this.finish()
  }

  private ensureContext(): WechatMiniprogram.InnerAudioContext {
    if (this.context) return this.context
    const context = wx.createInnerAudioContext()
    context.autoplay = false
    context.loop = false
    context.volume = 1
    context.onEnded(this.finish)
    context.onStop(this.finish)
    context.onError(this.handleError)
    this.context = context
    return context
  }

  private releaseContext(): void {
    const context = this.context
    if (!context) {
      this.finish()
      return
    }
    context.offEnded(this.finish)
    context.offStop(this.finish)
    context.offError(this.handleError)
    context.stop()
    context.destroy()
    this.context = null
    this.finish()
  }

  async play(word: string): Promise<boolean> {
    const requestId = ++this.requestId
    try {
      const source = await resolveAudioSource(word)
      if (requestId !== this.requestId) return false
      this.releaseContext()
      const context = this.ensureContext()
      this.activePath = source
      ambientAudioService.duckForSpeech()
      context.src = source
      context.play()
      return true
    } catch (_error) {
      if (requestId === this.requestId) this.finish()
      return false
    }
  }

  stop(): void {
    this.requestId += 1
    this.releaseContext()
  }

  destroy(): void {
    this.stop()
  }
}

export const wordAudioService = new WordAudioService()
