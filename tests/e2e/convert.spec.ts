import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { FIX, close, launch, makePdf, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

test('PDF 转图片：每页一张', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '宣传册.pdf', 3)
  await openTool(ctx, 'pdf-to-images')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.single-file h3')).toHaveText('宣传册.pdf')
  await expect(page.locator('.tip')).toContainText('1240 × 1754')
  await page.locator('.segmented button', { hasText: 'PNG' }).click()
  await shot(ctx, '15-pdf-to-images')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 30000 })
  const files = (await readdir(join(dir, '宣传册_图片'))).sort()
  expect(files).toEqual(['宣传册_01.png', '宣传册_02.png', '宣传册_03.png'])
  const png = await readFile(join(dir, '宣传册_图片', files[0]))
  expect(png.readUInt32BE(16)).toBe(1240)
})

test('PDF 转长图', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '菜单.pdf', 2)
  await openTool(ctx, 'pdf-to-long-image')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await page.locator('.segmented button', { hasText: '标准' }).click()
  await page.locator('.toggle', { hasText: '页面之间留出间隔' }).click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 30000 })
  expect(existsSync(join(dir, '菜单_长图.jpg'))).toBe(true)
})

test('PDF 转文字：中文', async () => {
  const { page, dir } = ctx
  await openTool(ctx, 'pdf-to-txt')
  await mockOpenDialog(ctx, [join(FIX, 'cjk-nonembedded.pdf')])
  await page.getByTestId('dropzone').click()
  // 输出到临时目录，避免写入测试素材目录
  await mockOpenDialog(ctx, [dir])
  await page.locator('.output-box button', { hasText: '更改' }).click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 30000 })
  const text = await readFile(join(dir, 'cjk-nonembedded.txt'), 'utf8')
  expect(text).toContain('关于印发工作方案的通知')
  await page.locator('button', { hasText: '继续处理' }).click()
  await page.locator('button', { hasText: '恢复为源文件所在文件夹' }).click()
})

test('PDF 转 PPT', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '方案.pdf', 2)
  await openTool(ctx, 'pdf-to-ppt')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 30000 })
  expect(existsSync(join(dir, '方案.pptx'))).toBe(true)
})

test('处理中可以取消', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '大文件.pdf', 60)
  await openTool(ctx, 'pdf-to-images')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await page.locator('.segmented button', { hasText: 'PNG' }).click()
  await page.locator('.segmented button', { hasText: '印刷' }).click()
  await page.locator('[data-action="run"]').click()
  await expect(page.locator('[data-action="cancel"]')).toBeVisible()
  await shot(ctx, '16-progress')
  await page.locator('[data-action="cancel"]').click()
  await expect(page.locator('[data-action="run"]')).toBeEnabled()
  await expect(page.getByTestId('result')).toHaveCount(0)
  const made = existsSync(join(dir, '大文件_图片')) ? (await readdir(join(dir, '大文件_图片'))).length : 0
  expect(made).toBeLessThan(60)
})
