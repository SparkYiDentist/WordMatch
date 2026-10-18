import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sampleRate = 22050
const durationSeconds = 30
const sampleCount = sampleRate * durationSeconds
const data = Buffer.alloc(sampleCount)
let seed = 0x51f15e

const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

let filtered = 0
for (let index = 0; index < sampleCount; index += 1) {
  const white = random() * 2 - 1
  filtered = filtered * 0.12 + white * 0.88
  data[index] = Math.max(0, Math.min(255, Math.round(128 + filtered * 30)))
}

const seamSamples = 4096
for (let index = 0; index < seamSamples; index += 1) {
  const mix = index / (seamSamples - 1)
  const tailIndex = sampleCount - seamSamples + index
  data[tailIndex] = Math.round(data[tailIndex] * (1 - mix) + data[index] * mix)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(sampleRate, 24)
header.writeUInt32LE(sampleRate, 28)
header.writeUInt16LE(1, 32)
header.writeUInt16LE(8, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)

const target = resolve('miniprogram/packages/ambient-white-noise/white-noise.wav')
writeFileSync(target, Buffer.concat([header, data]), { flag: 'wx' })
console.log(`Generated ${target} (${durationSeconds}s, ${sampleRate} Hz, 8-bit mono)`)

