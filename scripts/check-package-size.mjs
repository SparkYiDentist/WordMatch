import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const projectConfigPath = path.join(projectRoot, 'project.config.json')
const projectConfig = JSON.parse(await readFile(projectConfigPath, 'utf8'))
const miniprogramRoot = path.resolve(projectRoot, projectConfig.miniprogramRoot || 'miniprogram')
const maxMainPackageBytes = 2 * 1024 * 1024

const normalize = value => value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
const ignoredFiles = new Set()
const ignoredFolders = []

for (const rule of projectConfig.packOptions?.ignore || []) {
  const value = normalize(String(rule.value || ''))
  if (!value) continue
  if (rule.type === 'folder') ignoredFolders.push(value)
  if (rule.type === 'file') ignoredFiles.add(value)
}

const isIgnored = relativePath => {
  const normalized = normalize(relativePath)
  if (ignoredFiles.has(normalized)) return true
  return ignoredFolders.some(folder => normalized === folder || normalized.startsWith(`${folder}/`))
}

const files = []
const visit = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    const relativePath = normalize(path.relative(miniprogramRoot, absolutePath))
    if (isIgnored(relativePath)) continue
    if (entry.isDirectory()) await visit(absolutePath)
    else if (entry.isFile()) files.push({ relativePath, bytes: (await stat(absolutePath)).size })
  }
}

await visit(miniprogramRoot)

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
const formatMiB = bytes => `${(bytes / 1024 / 1024).toFixed(3)} MiB`
const largest = [...files].sort((left, right) => right.bytes - left.bytes).slice(0, 8)

console.log(`Package source size: ${totalBytes.toLocaleString('en-US')} bytes (${formatMiB(totalBytes)})`)
console.log(`Configured upload limit: ${maxMainPackageBytes.toLocaleString('en-US')} bytes (2.000 MiB)`)
console.log(`Remaining source budget: ${formatMiB(maxMainPackageBytes - totalBytes)}`)
console.log('Largest included files:')
for (const file of largest) console.log(`  ${formatMiB(file.bytes).padStart(10)}  ${file.relativePath}`)

if (totalBytes > maxMainPackageBytes) {
  console.error('Package source size exceeds the 2 MiB main-package limit.')
  process.exitCode = 1
}
