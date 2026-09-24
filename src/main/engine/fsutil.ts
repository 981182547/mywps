import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/** 去掉扩展名的文件名 */
export function stem(path: string): string {
  const b = basename(path)
  const e = extname(b)
  return e ? b.slice(0, -e.length) : b
}

/** 清理用户输入的文件名，并确保扩展名正确 */
export function sanitizeFileName(name: string, ext: string): string {
  let n = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  n = n.replace(/[. ]+$/, '')
  if (n.toLowerCase().endsWith(ext.toLowerCase())) n = n.slice(0, -ext.length)
  if (n === '') n = '未命名'
  return n + ext
}

/** 不覆盖已有文件：重名时自动加 " (2)"、" (3)"… */
export function uniquePath(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const base = ext ? fileName.slice(0, -ext.length) : fileName
  let candidate = join(dir, fileName)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base} (${i})${ext}`)
  return candidate
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** 先写临时文件再改名，避免中途失败留下半个文件 */
export async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  await ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const buf = await readFile(path)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}
