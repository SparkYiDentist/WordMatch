export type AmbientSoundId = 'off' | 'rain' | 'forest' | 'ocean' | 'stream' | 'white-noise'

export interface AmbientSoundOption {
  id: Exclude<AmbientSoundId, 'off'>
  name: string
  englishName: string
  fileName: string
  remoteUrl: string
}

export interface AmbientAudioState {
  soundId: AmbientSoundId
  playing: boolean
  loading: boolean
  error: string
}

type StateListener = (state: AmbientAudioState) => void

type AmbientSoundFileId = Exclude<AmbientSoundId, 'off'>

const AMBIENT_ASSET_BASE_URL = 'https://raw.githubusercontent.com/SparkYiDentist/WordMatch/main/remote-assets/ambient'
const AMBIENT_CACHE_VERSION = 'v2'
const ambientCacheDirectory = (): string => `${wx.env.USER_DATA_PATH}/wordmatch-cache/audio/ambient-${AMBIENT_CACHE_VERSION}`
const ambientCachePath = (option: AmbientSoundOption): string => `${ambientCacheDirectory()}/${option.fileName}`

export const AMBIENT_SOUND_OPTIONS: readonly AmbientSoundOption[] = [
  { id: 'rain', name: '轻柔雨声', englishName: 'Rain', fileName: 'rain.mp3', remoteUrl: `${AMBIENT_ASSET_BASE_URL}/rain.mp3` },
  { id: 'forest', name: '森林晨光', englishName: 'Forest', fileName: 'forest.mp3', remoteUrl: `${AMBIENT_ASSET_BASE_URL}/forest.mp3` },
  { id: 'ocean', name: '海浪轻拍', englishName: 'Ocean', fileName: 'ocean.mp3', remoteUrl: `${AMBIENT_ASSET_BASE_URL}/ocean.mp3` },
  { id: 'stream', name: '山间溪流', englishName: 'Stream', fileName: 'stream.mp3', remoteUrl: `${AMBIENT_ASSET_BASE_URL}/stream.mp3` },
  { id: 'white-noise', name: '柔和白噪音', englishName: 'White Noise', fileName: 'white-noise.wav', remoteUrl: `${AMBIENT_ASSET_BASE_URL}/white-noise.wav` },
]

const optionById = (soundId: AmbientSoundId): AmbientSoundOption | undefined => (
  AMBIENT_SOUND_OPTIONS.find(option => option.id === soundId)
)

const pendingDownloads: Partial<Record<AmbientSoundFileId, Promise<string>>> = {}

const ensureCacheDirectory = (): void => {
  const fileSystem = wx.getFileSystemManager()
  try {
    fileSystem.accessSync(ambientCacheDirectory())
  } catch (_error) {
    fileSystem.mkdirSync(ambientCacheDirectory(), true)
  }
}

const cachedFileExists = (filePath: string): boolean => {
  try {
    wx.getFileSystemManager().accessSync(filePath)
    return true
  } catch (_error) {
    return false
  }
}

const removeCachedFile = (filePath: string): void => {
  try {
    wx.getFileSystemManager().unlinkSync(filePath)
  } catch (_error) {
    // The file is either absent or already unavailable; the next attempt will download it again.
  }
}

const downloadAmbientSound = (option: AmbientSoundOption): Promise<string> => {
  const existing = pendingDownloads[option.id]
  if (existing) return existing

  const destination = ambientCachePath(option)
  const download = new Promise<string>((resolve, reject) => {
    try {
      ensureCacheDirectory()
      wx.downloadFile({
        url: option.remoteUrl,
        filePath: destination,
        timeout: 30000,
        success: result => {
          if (result.statusCode >= 200 && result.statusCode < 300) resolve(destination)
          else {
            removeCachedFile(destination)
            reject(new Error(`音频下载失败：HTTP ${result.statusCode}`))
          }
        },
        fail: error => {
          removeCachedFile(destination)
          reject(new Error(error.errMsg || '音频下载失败'))
        },
      })
    } catch (error) {
      reject(error)
    }
  }).finally(() => {
    delete pendingDownloads[option.id]
  })
  pendingDownloads[option.id] = download
  return download
}

const resolveAmbientSource = async (option: AmbientSoundOption): Promise<string> => {
  const destination = ambientCachePath(option)
  if (cachedFileExists(destination)) return destination
  return downloadAmbientSound(option)
}

class AmbientAudioService {
  private context: WechatMiniprogram.InnerAudioContext | null = null
  private listener: StateListener | null = null
  private ducked = false
  private playRequestId = 0
  private state: AmbientAudioState = { soundId: 'off', playing: false, loading: false, error: '' }

  private readonly handlePlay = (): void => {
    this.updateState({ playing: true, loading: false, error: '' })
  }

  private readonly handlePause = (): void => {
    this.updateState({ playing: false, loading: false })
  }

  private readonly handleStop = (): void => {
    this.updateState({ playing: false, loading: false })
  }

  private readonly handleError = (error: WechatMiniprogram.InnerAudioContextOnErrorCallbackResult): void => {
    const message = error.errCode === 10003 || error.errCode === 10004
      ? '音频文件缺失或格式不受支持'
      : '环境音暂时无法播放'
    this.updateState({ playing: false, loading: false, error: message })
  }

  private readonly handleInterruption = (): void => {
    this.pause()
  }

  setListener(listener: StateListener | null): void {
    this.listener = listener
    if (listener) listener({ ...this.state })
  }

  getState(): AmbientAudioState {
    return { ...this.state }
  }

  private updateState(patch: Partial<AmbientAudioState>): void {
    this.state = { ...this.state, ...patch }
    if (this.listener) this.listener({ ...this.state })
  }

  private ensureContext(): WechatMiniprogram.InnerAudioContext {
    if (this.context) return this.context
    const context = wx.createInnerAudioContext()
    context.autoplay = false
    context.loop = true
    context.volume = 1
    context.onPlay(this.handlePlay)
    context.onPause(this.handlePause)
    context.onStop(this.handleStop)
    context.onError(this.handleError)
    wx.onAudioInterruptionBegin(this.handleInterruption)
    this.context = context
    return context
  }

  async play(soundId: AmbientSoundId): Promise<boolean> {
    const option = optionById(soundId)
    if (!option) {
      this.stop()
      return false
    }
    const requestId = ++this.playRequestId
    this.updateState({ soundId, loading: true, error: '' })
    try {
      const source = await resolveAmbientSource(option)
      if (requestId !== this.playRequestId || this.state.soundId !== soundId) return false
      const context = this.ensureContext()
      if (context.src !== source) {
        context.stop()
        context.src = source
      }
      context.volume = this.effectiveVolume()
      context.play()
      return true
    } catch (_error) {
      if (requestId === this.playRequestId) {
        this.updateState({ playing: false, loading: false, error: '声音下载失败，请检查网络后重试' })
      }
      return false
    }
  }

  pause(): void {
    if (this.context && !this.context.paused) this.context.pause()
    else this.updateState({ playing: false, loading: false })
  }

  stop(): void {
    this.playRequestId += 1
    if (this.context) this.context.stop()
    this.updateState({ soundId: 'off', playing: false, loading: false, error: '' })
  }

  duckForSpeech(): void {
    this.ducked = true
    if (this.context) this.context.volume = this.effectiveVolume()
  }

  restoreAfterSpeech(): void {
    this.ducked = false
    if (this.context) this.context.volume = this.effectiveVolume()
  }

  private effectiveVolume(): number {
    return this.ducked ? 0.25 : 1
  }

  destroy(): void {
    this.playRequestId += 1
    this.listener = null
    wx.offAudioInterruptionBegin(this.handleInterruption)
    if (this.context) {
      this.context.offPlay(this.handlePlay)
      this.context.offPause(this.handlePause)
      this.context.offStop(this.handleStop)
      this.context.offError(this.handleError)
      this.context.stop()
      this.context.destroy()
      this.context = null
    }
    this.ducked = false
    this.state = { soundId: 'off', playing: false, loading: false, error: '' }
  }
}

export const ambientAudioService = new AmbientAudioService()

