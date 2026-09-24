import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { launchOptions, makePdf } from './helpers'

test('把文件拖到程序图标上打开：显示推荐工具', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qx-open-'))
  const pdf = await makePdf(dir, '从图标打开.pdf', 2)
  const app = await electron.launch(launchOptions({}, [pdf]))
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.suggest-card')).toBeVisible()
    await expect(page.locator('.suggest-card')).toContainText('已选择 1 个文件')
    await page.locator('.suggest-item', { hasText: 'PDF 拆分' }).click()
    await expect(page.locator('.single-file h3')).toHaveText('从图标打开.pdf')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
