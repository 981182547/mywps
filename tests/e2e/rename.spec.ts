import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { close, launch, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

let ctx: Ctx
test.beforeAll(async () => {
  ctx = await launch()
})
test.afterAll(() => close(ctx))

test('批量重命名：预览、冲突提示、执行、撤销', async () => {
  const { page, dir } = ctx
  const files = ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG']
  for (const f of files) await writeFile(join(dir, f), f)
  await openTool(ctx, 'batch-rename')
  await mockOpenDialog(ctx, files.map((f) => join(dir, f)))
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.rename-table tbody tr')).toHaveCount(3)

  // 冲突：所有文件改成同一个名字
  await page.fill('input[aria-label="名称模板"]', '相同')
  await expect(page.locator('.rename-table .problem').first()).toContainText('重复')
  await expect(page.locator('[data-action="run"]')).toBeDisabled()

  await page.fill('input[aria-label="名称模板"]', '三亚旅行_{n}')
  await page.locator('.segmented button', { hasText: '小写' }).click()
  await expect(page.locator('.rename-table tbody tr').first()).toContainText('三亚旅行_01.jpg')
  await shot(ctx, '28-rename')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect((await readdir(dir)).filter((f) => !f.startsWith('.')).sort()).toEqual(['三亚旅行_01.jpg', '三亚旅行_02.jpg', '三亚旅行_03.jpg'])

  await page.locator('[data-action="undo-rename"]').click()
  await expect(page.getByTestId('result')).toHaveCount(0)
  expect((await readdir(dir)).sort()).toEqual(files)
  await expect(page.locator('.rename-table tbody tr').first()).toContainText('IMG_0001.JPG')
})
