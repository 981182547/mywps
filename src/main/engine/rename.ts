// 批量重命名：先全部改为临时名称，再改为目标名称，支持互换名称；任何一步失败都会回滚
import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { findConflicts } from '../../shared/rename'
import { UserError } from '../../shared/ranges'
import type { BatchResult, RenameJob } from '../../shared/types'
import { noop, type Progress } from './pdf'

export async function renameFiles(job: RenameJob, progress: Progress = noop): Promise<BatchResult> {
  const items = job.items.filter((it) => basename(it.from) !== it.to)
  if (items.length === 0) throw new UserError('新名称与原名称相同，不需要重命名')
  const dirs = items.map((it) => dirname(it.from))
  const problems = findConflicts(dirs, items.map((it) => it.to))
  const bad = problems.findIndex(Boolean)
  if (bad >= 0) throw new UserError(`“${items[bad].to}”：${problems[bad]}`)
  const sources = new Set(items.map((it) => it.from.toLowerCase()))
  for (const it of items) {
    if (!existsSync(it.from)) throw new UserError(`找不到“${basename(it.from)}”，文件可能已被移动或删除`)
    const target = join(dirname(it.from), it.to)
    // 目标已存在且不是本次会被改名的文件（大小写不同的同名文件除外）
    if (existsSync(target) && !sources.has(target.toLowerCase()) && target.toLowerCase() !== it.from.toLowerCase()) {
      throw new UserError(`“${it.to}”已经存在，为避免覆盖已停止`)
    }
  }

  const stamp = `${process.pid}-${Date.now().toString(36)}`
  const temps = items.map((it, i) => join(dirname(it.from), `.qx-rename-${stamp}-${i}`))
  const moved: { from: string; to: string }[] = []
  const rollback = async () => {
    for (const m of moved.reverse()) await rename(m.to, m.from).catch(() => undefined)
  }
  try {
    for (let i = 0; i < items.length; i++) {
      await rename(items[i].from, temps[i])
      moved.push({ from: items[i].from, to: temps[i] })
      progress((0.5 * i) / items.length, `正在重命名（${i + 1} / ${items.length}）`)
    }
    const outputs: string[] = []
    for (let i = 0; i < items.length; i++) {
      const target = join(dirname(items[i].from), items[i].to)
      await rename(temps[i], target)
      moved.push({ from: temps[i], to: target })
      outputs.push(target)
      progress(0.5 + (0.5 * i) / items.length, `正在重命名（${i + 1} / ${items.length}）`)
    }
    progress(1, '完成')
    return { outputs, notes: [`已重命名 ${items.length} 个文件`], failures: [] }
  } catch (e) {
    await rollback()
    const code = (e as NodeJS.ErrnoException)?.code
    throw new UserError(code === 'EBUSY' || code === 'EPERM' ? '有文件正在被其他程序使用，已全部恢复原名，请关闭相关程序后重试' : '重命名失败，已全部恢复原名')
  }
}
