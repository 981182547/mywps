import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renameFiles } from '../../src/main/engine/rename'
import { applyRule, findConflicts, nameProblem } from '../../src/shared/rename'
import { tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

const rule = { template: '{name}', start: 1, digits: 2, find: '', replace: '', extCase: 'keep' as const }

describe('重命名规则', () => {
  it('模板、序号、查找替换、扩展名大小写', () => {
    const files = [{ name: 'IMG_001.JPG', mtime: new Date(2024, 7, 15).getTime() }, { name: 'IMG_002.JPG' }]
    expect(applyRule(files, { ...rule, template: '旅行_{n}' })).toEqual(['旅行_01.JPG', '旅行_02.JPG'])
    expect(applyRule(files, { ...rule, find: 'IMG_', replace: '照片', extCase: 'lower' })).toEqual(['照片001.jpg', '照片002.jpg'])
    expect(applyRule(files, { ...rule, template: '{date}_{name}', start: 9, digits: 3 })[0]).toBe('20240815_IMG_001.JPG')
    expect(applyRule([{ name: 'README' }], { ...rule, template: '说明' })).toEqual(['说明'])
  })

  it('非法名称与重复名称', () => {
    expect(nameProblem('a:b.txt')).toContain('不允许的字符')
    expect(nameProblem('CON.txt')).toContain('保留')
    expect(nameProblem('.txt')).toContain('不能为空')
    expect(findConflicts(['d', 'd', 'e'], ['A.txt', 'a.TXT', 'a.txt'])).toEqual(['与其他文件的新名称重复', '与其他文件的新名称重复', null])
  })
})

describe('批量重命名', () => {
  it('改名成功，内容不变', async () => {
    await writeFile(join(dir, 'a.txt'), 'A')
    await writeFile(join(dir, 'b.txt'), 'B')
    const r = await renameFiles({ type: 'rename', items: [{ from: join(dir, 'a.txt'), to: '一.txt' }, { from: join(dir, 'b.txt'), to: '二.txt' }] })
    expect(r.outputs).toHaveLength(2)
    expect(await readFile(join(dir, '一.txt'), 'utf8')).toBe('A')
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
  })

  it('支持两个文件互换名称', async () => {
    await writeFile(join(dir, 'a.txt'), 'A')
    await writeFile(join(dir, 'b.txt'), 'B')
    await renameFiles({ type: 'rename', items: [{ from: join(dir, 'a.txt'), to: 'b.txt' }, { from: join(dir, 'b.txt'), to: 'a.txt' }] })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('B')
    expect(await readFile(join(dir, 'b.txt'), 'utf8')).toBe('A')
  })

  it('目标已存在时停止，不覆盖任何文件', async () => {
    await writeFile(join(dir, 'a.txt'), 'A')
    await writeFile(join(dir, '已有.txt'), 'KEEP')
    await expect(renameFiles({ type: 'rename', items: [{ from: join(dir, 'a.txt'), to: '已有.txt' }] })).rejects.toThrow('已经存在')
    expect(await readFile(join(dir, '已有.txt'), 'utf8')).toBe('KEEP')
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('A')
  })

  it('中途失败时全部回滚，不留临时文件', async () => {
    await writeFile(join(dir, 'a.txt'), 'A')
    await expect(
      renameFiles({ type: 'rename', items: [{ from: join(dir, 'a.txt'), to: 'x.txt' }, { from: join(dir, '不存在.txt'), to: 'y.txt' }] })
    ).rejects.toThrow('找不到')
    expect((await readdir(dir)).sort()).toEqual(['a.txt'])
  })

  it('撤销：用反向映射改回原名', async () => {
    await writeFile(join(dir, 'a.txt'), 'A')
    const r = await renameFiles({ type: 'rename', items: [{ from: join(dir, 'a.txt'), to: 'z.txt' }] })
    await renameFiles({ type: 'rename', items: [{ from: r.outputs[0], to: 'a.txt' }] })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('A')
  })
})
