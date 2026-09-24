import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { renderPage } from '../unit/helpers'
import { FIX, close, launch, makePdf, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

test('手写签名、拖动、复制到所有页、骑缝章', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '合同.pdf', 3)
  await openTool(ctx, 'pdf-sign')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.getByTestId('sign-page')).toBeVisible()
  await expect(page.locator('.side-footer')).toContainText('点击右侧的签名或印章')

  // 手写签名
  await page.locator('[data-action="new-signature"]').click()
  const pad = page.getByTestId('sig-pad')
  const b = (await pad.boundingBox())!
  await page.mouse.move(b.x + 60, b.y + 120)
  await page.mouse.down()
  for (let i = 0; i <= 30; i++) await page.mouse.move(b.x + 60 + i * 12, b.y + 120 + Math.sin(i / 3) * 40, { steps: 2 })
  await page.mouse.up()
  await shot(ctx, '23-signature-pad')
  await page.locator('[data-action="save-signature"]').click()
  await expect(page.getByTestId('placed')).toHaveCount(1)

  // 拖动到页面左下方
  const placed = page.getByTestId('placed').first()
  const pb = (await placed.boundingBox())!
  const pageBox = (await page.getByTestId('sign-page').boundingBox())!
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
  await page.mouse.down()
  await page.mouse.move(pageBox.x + pageBox.width * 0.25, pageBox.y + pageBox.height * 0.85, { steps: 8 })
  await page.mouse.up()
  await page.locator('[data-action="copy-all"]').click()
  await expect(page.locator('.files-toolbar .summary')).toContainText('已放置 3 处')

  // 导入印章图片（自动去除白底）作为骑缝章
  await page.locator('[data-action="new-signature"]').click()
  await page.locator('.modal .segmented button', { hasText: '导入图片' }).click()
  await mockOpenDialog(ctx, [join(FIX, 'photo.bmp')])
  await page.locator('.modal button', { hasText: '选择图片' }).click()
  await expect(page.locator('.modal .sig-preview img')).toBeVisible()
  await page.locator('[data-action="save-signature"]').click()
  await expect(page.locator('.sig-library .sig-card:not(.add)')).toHaveCount(2)
  // 新建后自动放置到当前页，这里删除它，只用作骑缝章
  await page.keyboard.press('Delete')
  await expect(page.locator('.files-toolbar .summary')).toContainText('已放置 3 处')
  await page.locator('.toggle', { hasText: '加盖骑缝章' }).click()
  await page.locator('.sig-library.compact button').nth(1).click()
  await expect(page.locator('.seam-slice')).toBeVisible()
  await shot(ctx, '24-sign')

  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const out = join(dir, '合同_已签署.pdf')
  for (let p = 1; p <= 3; p++) {
    const r = await renderPage(out, p, 0.5)
    // 签名在左下区域
    expect(r.inkRatio(0.05, 0.7, 0.5, 1)).toBeGreaterThan(0.005)
    // 骑缝章在右边缘中部
    expect(r.inkRatio(0.9, 0.35, 1, 0.65)).toBeGreaterThan(0.05)
  }
})

test('签名库在重新打开后仍然保留', async () => {
  const { page, dir } = ctx
  await page.reload()
  await page.waitForSelector('text=今天要处理什么文件？')
  const src = await makePdf(dir, 'b.pdf', 1)
  await openTool(ctx, 'pdf-sign')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.sig-library .sig-card:not(.add)')).toHaveCount(2)
})
