import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { FIX, close, launch, mockOpenDialog, openTool, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

test('未嵌入字体的中文 PDF 在界面中能正确预览（依赖随程序附带的字体映射资源）', async () => {
  const { page, dir } = ctx
  const src = join(dir, '通知.pdf')
  await copyFile(join(FIX, 'cjk-nonembedded.pdf'), src)
  await openTool(ctx, 'pdf-page-numbers')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  const img = page.locator('.pp-page img')
  await expect(img).toBeVisible()
  // 统计预览图上部（标题所在区域）的深色像素
  const dark = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode()
    const c = document.createElement('canvas')
    c.width = el.naturalWidth
    c.height = el.naturalHeight
    const g = c.getContext('2d')!
    g.drawImage(el, 0, 0)
    const d = g.getImageData(0, 0, c.width, Math.floor(c.height * 0.3)).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) n++
    return n
  })
  expect(dark).toBeGreaterThan(200)
})
