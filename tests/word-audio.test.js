const test = require('node:test')
const assert = require('node:assert/strict')

const wordAudio = require('../.test-build/services/word-audio-service.js')

test('单词语音路径与已上传 manifest 的稳定 SHA-256 路径一致', () => {
  assert.equal(
    wordAudio.sha256Hex('apple'),
    '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b',
  )
  assert.deepEqual(wordAudio.getWordAudioAsset(' Apple '), {
    key: '3a7bd3e2360a3d29eea436fc',
    remoteUrl: 'https://raw.githubusercontent.com/SparkYiDentist/WordMatch/main/remote-assets/word-audio/audio/3a/3a7bd3e2360a3d29eea436fc.mp3',
  })
})

test('单词语音路径支持连字符并拒绝空词条', () => {
  assert.equal(wordAudio.getWordAudioAsset('  '), null)
  const asset = wordAudio.getWordAudioAsset('well-being')
  assert.ok(asset)
  assert.match(asset.remoteUrl, /\/audio\/[0-9a-f]{2}\/[0-9a-f]{24}\.mp3$/)
})

test('单词语音首次下载后复用本地缓存', async () => {
  const existing = new Set()
  let downloads = 0
  let plays = 0
  global.wx = {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({
      accessSync(path) { if (!existing.has(path)) throw new Error('missing') },
      mkdirSync(path) { existing.add(path) },
      unlinkSync(path) { existing.delete(path) },
    }),
    downloadFile: options => {
      downloads += 1
      existing.add(options.filePath)
      options.success({ statusCode: 200 })
    },
    createInnerAudioContext: () => ({
      autoplay: false,
      loop: false,
      volume: 1,
      paused: true,
      src: '',
      onEnded() {}, offEnded() {}, onStop() {}, offStop() {}, onError() {}, offError() {},
      stop() {}, destroy() {},
      play() { plays += 1 },
    }),
  }

  assert.equal(await wordAudio.wordAudioService.play('apple'), true)
  assert.equal(await wordAudio.wordAudioService.play('APPLE'), true)
  assert.equal(downloads, 1)
  assert.equal(plays, 2)
  wordAudio.wordAudioService.destroy()
  delete global.wx
})
