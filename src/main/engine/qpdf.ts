// qpdf（WebAssembly 版）：PDF 加密、解密、结构优化与修复
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

interface QpdfInstance {
  callMain(args: string[]): number
  FS: {
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
    unlink(path: string): void
  }
}

let instance: Promise<QpdfInstance> | null = null

async function qpdf(): Promise<QpdfInstance> {
  instance ??= (async () => {
    const req = createRequire(__filename)
    const entry = req.resolve('@neslinesli93/qpdf-wasm')
    const create = (await import('@neslinesli93/qpdf-wasm')).default as unknown as (o: object) => Promise<QpdfInstance>
    return create({
      locateFile: (f: string) => join(dirname(entry), f),
      // 不向控制台输出 qpdf 的提示信息
      print: () => undefined,
      printErr: () => undefined,
      noExitRuntime: true
    })
  })()
  return instance
}

/** 运行 qpdf，返回退出码：0 成功，2 错误，3 有警告但已完成 */
function call(q: QpdfInstance, args: string[]): number {
  try {
    return q.callMain(args)
  } catch (e) {
    const status = (e as { status?: number })?.status
    if (typeof status === 'number') return status
    throw e
  }
}

let seq = 0

/** 在 qpdf 的虚拟文件系统中处理：输入字节，返回输出字节或退出码 */
export async function runQpdf(input: Uint8Array, args: (inPath: string, outPath: string) => string[]): Promise<{ code: number; output: Uint8Array | null }> {
  const q = await qpdf()
  const id = ++seq
  const inPath = `/in-${id}.pdf`
  const outPath = `/out-${id}.pdf`
  q.FS.writeFile(inPath, input)
  try {
    const code = call(q, args(inPath, outPath))
    let output: Uint8Array | null = null
    if (code === 0 || code === 3) {
      try {
        output = q.FS.readFile(outPath)
      } catch {
        output = null
      }
    }
    return { code, output }
  } finally {
    for (const p of [inPath, outPath]) {
      try {
        q.FS.unlink(p)
      } catch {
        /* 文件可能不存在 */
      }
    }
  }
}

/** 文件是否带有加密字典（不依赖 qpdf 的异常处理路径） */
async function hasEncryption(input: Uint8Array): Promise<boolean> {
  try {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false })
    return doc.isEncrypted
  } catch {
    const tail = Buffer.from(input.subarray(Math.max(0, input.length - 4096))).toString('latin1')
    return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail)
  }
}

/**
 * 判断是否需要密码：
 * 'none' 未加密；'open' 需要打开密码；'restricted' 已加密但无需密码即可打开（只限制了权限）
 *
 * 注意：此 WebAssembly 版 qpdf 在内部需要捕获异常的路径上（例如用错误密码试探）总是返回 2，
 * 因此只使用“密码正确时返回 3”这一可靠行为来判断。
 */
export async function encryptionState(input: Uint8Array): Promise<'none' | 'open' | 'restricted'> {
  if (!(await hasEncryption(input))) return 'none'
  return (await passwordWorks(input, '')) ? 'restricted' : 'open'
}

/** 检查密码是否正确（用户密码或所有者密码均可） */
export async function passwordWorks(input: Uint8Array, password: string): Promise<boolean> {
  const q = await qpdf()
  const id = ++seq
  const p = `/pw-${id}.pdf`
  q.FS.writeFile(p, input)
  try {
    // 提供了正确密码时返回 3（“已加密但不再需要密码”）
    return call(q, ['--requires-password', `--password=${password}`, p]) === 3
  } finally {
    q.FS.unlink(p)
  }
}
