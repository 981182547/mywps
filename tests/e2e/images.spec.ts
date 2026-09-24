import { copyFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { FIX, close, launch, loadPdf, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

/** 把测试图片复制到临时目录，避免输出写进素材目录 */
async function copies(names: string[]): Promise<string[]> {
  const out: string[] = []
  for (const n of names) {
    const p = join(ctx.dir, n)
    await copyFile(join(FIX, n), p)
    out.push(p)
  }
  return out
}

test('图片格式转换：HEIC 批量转 JPG，缩略图正常显示', async () => {
  const { page, dir } = ctx
  const files = await copies(['photo.heic', 'photo.bmp', 'photo.tiff', 'transparent.png'])
  await openTool(ctx, 'image-convert')
  await mockOpenDialog(ctx, files)
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.image-tile')).toHaveCount(4)
  // 所有缩略图（包括 HEIC、TIFF）都能显示，且显示了像素尺寸
  await expect(page.locator('.image-tile img')).toHaveCount(4)
  await expect(page.locator('.image-tile').first()).toContainText('200×100')
  await page.locator('[data-format="jpg"]').click()
  await expect(page.locator('[data-action="run"]')).toContainText('4 张')
  await shot(ctx, '17-image-convert')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const names = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort()
  expect(names).toEqual(['photo (2).jpg', 'photo (3).jpg', 'photo.jpg', 'transparent.jpg'].sort())
  const m = await sharp(join(dir, 'photo.jpg')).metadata()
  expect([m.format, m.width, m.height]).toEqual(['jpeg', 200, 100])
})

test('图片压缩：指定大小，显示压缩前后大小', async () => {
  const { page, dir } = ctx
  // 生成一张较大的照片
  const w = 1600
  const h = 1200
  const raw = Buffer.alloc(w * h * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251
  const big = join(dir, '旅行照片.jpg')
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 97 }).toFile(big)
  await openTool(ctx, 'image-compress')
  await mockOpenDialog(ctx, [big])
  await page.getByTestId('dropzone').click()
  await page.locator('.segmented button', { hasText: '指定大小' }).click()
  await page.locator('.quick-chips button', { hasText: '200 KB' }).click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 60000 })
  await expect(page.getByTestId('result-notes')).toContainText('旅行照片.jpg')
  await shot(ctx, '18-image-compress-done')
  expect((await stat(join(dir, '旅行照片_压缩.jpg'))).size).toBeLessThanOrEqual(200 * 1024)
})

test('调整尺寸：一寸照', async () => {
  const { page, dir } = ctx
  const [src] = await copies(['plain.jpg'])
  await openTool(ctx, 'image-resize')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await page.locator('.segmented button', { hasText: '指定尺寸' }).click()
  await page.locator('.preset-grid button', { hasText: '一寸照' }).click()
  await shot(ctx, '19-image-resize')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const m = await sharp(join(dir, 'plain_295x413.jpg')).metadata()
  expect([m.width, m.height]).toEqual([295, 413])
})

test('图片转 PDF：HEIC 照片', async () => {
  const { page, dir } = ctx
  const files = await copies(['photo.heic', 'rotated-exif6.jpg'])
  await openTool(ctx, 'images-to-pdf')
  await mockOpenDialog(ctx, files)
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.image-tile img')).toHaveCount(2)
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect((await loadPdf(join(dir, 'photo_图片合集.pdf'))).getPageCount()).toBe(2)
})
