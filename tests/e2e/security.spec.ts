import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { FIX, close, launch, makePdf, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

test('加密后再解密：完整往返', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '工资单.pdf', 2)
  await openTool(ctx, 'pdf-encrypt')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.tip', { hasText: '没有加密' })).toBeVisible()
  await page.fill('input[aria-label="打开密码"]', 'Abc#2024')
  await page.fill('input[aria-label="确认打开密码"]', 'Abc#2023')
  await expect(page.locator('.side-footer')).toContainText('两次输入的打开密码不一致')
  await page.fill('input[aria-label="确认打开密码"]', 'Abc#2024')
  await page.fill('input[aria-label="权限密码"]', 'manager')
  await shot(ctx, '20-encrypt')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const encrypted = join(dir, '工资单_已加密.pdf')
  expect((await PDFDocument.load(await readFile(encrypted), { ignoreEncryption: true })).isEncrypted).toBe(true)

  // 解密
  await openTool(ctx, 'pdf-decrypt')
  await mockOpenDialog(ctx, [encrypted])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.tip', { hasText: '设置了打开密码' })).toBeVisible()
  await page.fill('input[aria-label="密码"]', 'wrong')
  await page.locator('[data-action="run"]').click()
  await expect(page.locator('.alert.error')).toContainText('密码不正确')
  await page.fill('input[aria-label="密码"]', 'Abc#2024')
  await shot(ctx, '21-decrypt')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const plain = await PDFDocument.load(await readFile(join(dir, '工资单_已加密_已解密.pdf')))
  expect(plain.isEncrypted).toBe(false)
  expect(plain.getPageCount()).toBe(2)
})

test('解密：未加密的文件给出提示', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '普通.pdf', 1)
  await openTool(ctx, 'pdf-decrypt')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.side-footer')).toContainText('没有加密')
  await expect(page.locator('[data-action="run"]')).toBeDisabled()
})

test('PDF 压缩：显示压缩效果', async () => {
  const { page, dir } = ctx
  const w = 2000
  const h = 2800
  const raw = Buffer.alloc(w * h * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = 120 + ((i * 7) % 40)
  const doc = await PDFDocument.create()
  const p = doc.addPage([595, 842])
  p.drawImage(await doc.embedJpg(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 98 }).toBuffer()), { x: 0, y: 0, width: 595, height: 842 })
  const src = join(dir, '扫描合同.pdf')
  await writeFile(src, await doc.save())
  await openTool(ctx, 'pdf-compress')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await page.locator('[data-level="high"]').click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 60000 })
  await expect(page.getByTestId('result-notes')).toContainText('减小')
  await shot(ctx, '22-compress-done')
  expect((await stat(join(dir, '扫描合同_压缩.pdf'))).size).toBeLessThan((await stat(src)).size / 2)
})

test('PDF 修复：接受无法预览的损坏文件', async () => {
  const { page, dir } = ctx
  const good = await makePdf(dir, '损坏.pdf', 2)
  const text = Buffer.from(await readFile(good)).toString('latin1').replace(/startxref\s+\d+/, 'startxref\n9999999').replace('%PDF-1.7', '%PDF-1.7')
  await writeFile(good, Buffer.from(text, 'latin1'))
  await openTool(ctx, 'pdf-repair')
  await mockOpenDialog(ctx, [good])
  await page.getByTestId('dropzone').click()
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  await expect(page.getByTestId('result-notes')).toContainText('恢复 2 页')
})

test('加密文件在合并工具中被识别', async () => {
  const { page, dir } = ctx
  const enc = join(dir, 'enc.pdf')
  await copyFile(join(FIX, 'encrypted.pdf'), enc)
  const src = await makePdf(dir, 'x.pdf', 1)
  await openTool(ctx, 'pdf-merge')
  await mockOpenDialog(ctx, [src, enc])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.file-row').nth(1)).toContainText('有打开密码')
})
