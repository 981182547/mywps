import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { expect, test } from '@playwright/test'
import { close, launch, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

async function scan(name: string, lines: string[]): Promise<string> {
  const c = createCanvas(1400, 600)
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#111'
  g.font = '50px "Microsoft YaHei", "PingFang SC", "WenQuanYi Zen Hei", "Noto Sans CJK SC", sans-serif'
  lines.forEach((l, i) => g.fillText(l, 80, 140 + i * 110))
  const p = join(ctx.dir, name)
  await writeFile(p, await c.encode('png'))
  return p
}

test('图片转文字：结果可直接复制', async () => {
  const { page, app } = ctx
  const img = await scan('截图.png', ['会议纪要：下周一上午九点开会', '请各部门准时参加'])
  await openTool(ctx, 'ocr-image')
  await mockOpenDialog(ctx, [img])
  await page.getByTestId('dropzone').click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 120000 })
  await expect(page.getByTestId('result-preview')).toHaveValue(/会议纪要：下周一上午九点开会/)
  await page.locator('button', { hasText: '复制全部文字' }).click()
  await expect(page.locator('button', { hasText: '已复制' })).toBeVisible()
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clip).toContain('请各部门准时参加')
  await shot(ctx, '27-ocr-image')
})

test('扫描件识别：生成可搜索 PDF', async () => {
  const { page, dir } = ctx
  const img = await scan('扫描.png', ['房屋租赁合同', '出租方：张三'])
  // 先用“图片转 PDF”生成扫描件
  await openTool(ctx, 'images-to-pdf')
  await mockOpenDialog(ctx, [img])
  await page.getByTestId('dropzone').click()
  await page.fill('input[aria-label="输出文件名"]', '租赁合同扫描件')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()

  await openTool(ctx, 'ocr-pdf')
  await mockOpenDialog(ctx, [join(dir, '租赁合同扫描件.pdf')])
  await page.getByTestId('dropzone').click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 180000 })
  await expect(page.getByTestId('result-preview')).toHaveValue(/房屋租赁合同/)
  await expect(page.getByTestId('result-notes')).toContainText('识别了 1 页')
})
