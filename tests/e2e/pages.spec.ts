import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { close, launch, loadPdf, makePdf, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

test('旋转页面：选中奇数页向右旋转', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '扫描件.pdf', 4)
  await openTool(ctx, 'pdf-rotate')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.page-card')).toHaveCount(4)
  await expect(page.locator('[data-action="run"]')).toBeDisabled()
  await expect(page.locator('.side-footer')).toContainText('还没有做任何修改')
  await page.locator('.page-toolbar button', { hasText: '奇数页' }).click()
  await expect(page.locator('.page-card.selected')).toHaveCount(2)
  await page.locator('[data-action="rotate-right"]').click()
  await expect(page.locator('.page-card .pc-badge')).toHaveCount(2)
  // 等缩略图加载完成再截图
  await expect(page.locator('.page-card img')).toHaveCount(4)
  await shot(ctx, '11-rotate')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const doc = await loadPdf(join(dir, '扫描件_已旋转.pdf'))
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 90, 0])
})

test('删除页面：点选、Delete 键、撤销', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '合同.pdf', 5, [0.93, 0.27, 0.42])
  await openTool(ctx, 'pdf-delete')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.page-card')).toHaveCount(5)
  await page.locator('.page-card[data-page="2"]').click()
  await page.locator('.page-card[data-page="4"]').click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.page-card.deleted')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.page-card.deleted')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z') // 无效快捷键不应出错
  // 通过页码选择
  await page.fill('input[aria-label="按页码选择"]', '2,4')
  await page.locator('button', { hasText: '选择' }).click()
  await page.locator('[data-action="delete"]').click()
  await expect(page.locator('.page-card.deleted')).toHaveCount(2)
  await expect(page.locator('.stat-grid')).toContainText('3')
  await expect(page.locator('.page-card img')).toHaveCount(5)
  await shot(ctx, '12-delete')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect((await loadPdf(join(dir, '合同_已删页.pdf'))).getPageCount()).toBe(3)
})

test('页面排序：倒序与拖动', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '讲义.pdf', 4)
  // 每页宽度不同，便于识别顺序
  await openTool(ctx, 'pdf-reorder')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.page-card')).toHaveCount(4)
  await page.locator('[data-action="reverse"]').click()
  await expect(page.locator('.page-card').first()).toHaveAttribute('data-page', '4')
  // 把第一张（原第 4 页）拖到最后
  const first = page.locator('.page-card').nth(0)
  const last = page.locator('.page-card').nth(3)
  await first.dragTo(last, { targetPosition: { x: 140, y: 60 } })
  await expect(page.locator('.page-card').last()).toHaveAttribute('data-page', '4')
  const order = await page.locator('.page-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-page')))
  expect(order).toEqual(['3', '2', '1', '4'])
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect((await loadPdf(join(dir, '讲义_已排序.pdf'))).getPageCount()).toBe(4)
})

test('添加水印：实时预览与结果', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '报价单.pdf', 3)
  await openTool(ctx, 'pdf-watermark')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.getByTestId('preview-overlay')).toBeVisible()
  await page.fill('textarea[aria-label="水印文字"]', '机密 仅供内部使用')
  await page.locator('.segmented button', { hasText: '平铺满页' }).click()
  await page.locator('.swatch[aria-label="#e11d48"]').click()
  // 预览画布上确实画出了水印
  const inked = await page.getByTestId('preview-overlay').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
  expect(inked).toBeGreaterThan(1000)
  await shot(ctx, '13-watermark')
  await page.fill('input[aria-label="应用到页面"]', '9')
  await expect(page.locator('.side-footer')).toContainText('超出范围')
  await page.fill('input[aria-label="应用到页面"]', '')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect((await loadPdf(join(dir, '报价单_水印.pdf'))).getPageCount()).toBe(3)
})

test('添加页码：跳过封面', async () => {
  const { page, dir } = ctx
  const src = await makePdf(dir, '论文.pdf', 3)
  await openTool(ctx, 'pdf-page-numbers')
  await mockOpenDialog(ctx, [src])
  await page.getByTestId('dropzone').click()
  await expect(page.getByTestId('preview-overlay')).toBeVisible()
  await page.selectOption('select[aria-label="页码格式"]', 'cn-total')
  await page.locator('.pos-picker button[aria-label="右下"]').click()
  await page.locator('.quick-chips button', { hasText: '跳过封面' }).click()
  await page.locator('button[aria-label="下一页"]').click()
  await shot(ctx, '14-page-numbers')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect((await loadPdf(join(dir, '论文_页码.pdf'))).getPageCount()).toBe(3)
})
