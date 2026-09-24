import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const ROOT = join(__dirname, '../..')
const FIX = join(ROOT, 'tests/fixtures')
const SHOTS = join(ROOT, 'test-results/screens')

let app: ElectronApplication
let page: Page
let dir: string

async function makePdf(name: string, pages: number, color: [number, number, number]): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842])
    p.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: rgb(...color) })
    p.drawText(`Document - Page ${i}`, { x: 50, y: 600, size: 40, font })
    for (let l = 0; l < 12; l++) p.drawRectangle({ x: 50, y: 540 - l * 30, width: 400 - (l % 3) * 60, height: 10, color: rgb(0.85, 0.87, 0.9) })
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

async function pageCount(path: string): Promise<number> {
  return (await PDFDocument.load(await readFile(path))).getPageCount()
}

/** 让“打开文件”对话框直接返回指定路径 */
async function mockOpenDialog(paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog
  }, paths)
}

async function shot(name: string): Promise<void> {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qx-e2e-'))
  app = await electron.launch({
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 800 })
  await app.evaluate(({ shell }) => {
    shell.openPath = async () => ''
    shell.showItemInFolder = () => {}
  })
  await page.waitForSelector('text=今天要处理什么文件？')
  // 清除上次运行留下的设置（例如自定义输出目录）
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=今天要处理什么文件？')
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

test('首页展示工具，搜索可用', async () => {
  await expect(page.locator('[data-tool="pdf-merge"]').first()).toBeVisible()
  await shot('01-home-light')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await shot('02-home-dark')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))

  await page.keyboard.press('Control+k')
  await page.keyboard.type('拆分')
  await expect(page.locator('.tool-grid [data-tool]')).toHaveCount(1)
  await expect(page.locator('[data-tool="pdf-split"]')).toBeVisible()
  await page.fill('input[aria-label="搜索工具"]', '')
})

test('PDF 合并：添加、设置页码范围、合并', async () => {
  const a = await makePdf('合同A.pdf', 3, [0.39, 0.4, 0.96])
  const b = await makePdf('附件B.pdf', 5, [0.93, 0.27, 0.42])
  await page.locator('[data-tool="pdf-merge"]').first().click()
  await expect(page.locator('h1', { hasText: 'PDF 合并' })).toBeVisible()
  await shot('03-merge-empty')

  const runBtn = page.locator('[data-action="run"]')
  await expect(runBtn).toBeDisabled()

  await mockOpenDialog([a, b])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.file-row')).toHaveCount(2)
  await expect(page.locator('.files-toolbar .summary')).toContainText('合并后共 8 页')

  // 页码范围校验：超出范围时按钮不可用并提示
  await page.fill('input[aria-label="附件B.pdf 的页码范围"]', '9')
  await expect(page.locator('.file-row').nth(1)).toContainText('页码 9 超出范围')
  await expect(runBtn).toBeDisabled()
  await page.fill('input[aria-label="附件B.pdf 的页码范围"]', '1-2,5')
  await expect(page.locator('.files-toolbar .summary')).toContainText('合并后共 6 页')
  await expect(page.locator('input[aria-label="输出文件名"]')).toHaveValue('合同A_合并')
  await shot('04-merge-files')

  await runBtn.click()
  await expect(page.getByTestId('result')).toBeVisible()
  await shot('05-merge-done')
  const out = join(dir, '合同A_合并.pdf')
  expect(existsSync(out)).toBe(true)
  expect(await pageCount(out)).toBe(6)

  await page.locator('button', { hasText: '继续处理' }).click()
  await expect(page.getByTestId('dropzone')).toBeVisible()
  await page.locator('button[aria-label="返回"]').click()
})

test('PDF 合并：加密文件会被识别并阻止', async () => {
  const a = await makePdf('普通.pdf', 1, [0.2, 0.7, 0.5])
  await page.locator('[data-tool="pdf-merge"]').first().click()
  await mockOpenDialog([a, join(FIX, 'encrypted.pdf'), join(FIX, 'green.png')])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.file-row')).toHaveCount(2)
  await expect(page.locator('text=已忽略 1 个不支持的文件')).toBeVisible()
  await expect(page.locator('.file-row').nth(1)).toContainText('已加密')
  await expect(page.locator('[data-action="run"]')).toBeDisabled()
  await expect(page.locator('.side-footer')).toContainText('已加密，请先移除')
  await shot('06-merge-encrypted')
  await page.locator('.file-row').nth(1).hover()
  await page.locator('.file-row').nth(1).locator('button[aria-label="移除"]').click()
  await expect(page.locator('.side-footer')).toContainText('请至少添加 2 个 PDF 文件')
  await page.locator('button[aria-label="返回"]').click()
})

test('PDF 拆分：每 2 页一份', async () => {
  const src = await makePdf('年度报告.pdf', 5, [0.1, 0.6, 0.9])
  await page.locator('[data-tool="pdf-split"]').first().click()
  await mockOpenDialog([src])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.single-file h3')).toHaveText('年度报告.pdf')
  await page.fill('input[aria-label="每份页数"]', '2')
  await expect(page.getByTestId('split-preview').locator('.chip')).toHaveCount(3)
  await shot('07-split')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  await expect(page.locator('.result-file')).toHaveCount(3)
  await shot('08-split-done')
  const folder = join(dir, '年度报告_拆分')
  const files = (await readdir(folder)).sort()
  expect(files).toEqual(['年度报告_第1-2页.pdf', '年度报告_第3-4页.pdf', '年度报告_第5页.pdf'])
  expect(await pageCount(join(folder, files[2]))).toBe(1)
  await page.locator('button[aria-label="返回"]').click()
})

test('提取页面', async () => {
  const src = await makePdf('手册.pdf', 6, [0.95, 0.6, 0.1])
  await page.locator('[data-tool="pdf-extract"]').first().click()
  await mockOpenDialog([src])
  await page.getByTestId('dropzone').click()
  await page.fill('input[aria-label="要提取的页面"]', '2，4-5')
  await expect(page.getByTestId('split-preview')).toContainText('2、4、5')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  expect(await pageCount(join(dir, '手册_提取.pdf'))).toBe(3)
  await page.locator('button[aria-label="返回"]').click()
})

test('图片转 PDF：照片方向自动纠正', async () => {
  await page.locator('[data-tool="images-to-pdf"]').first().click()
  await mockOpenDialog([join(FIX, 'rotated-exif6.jpg'), join(FIX, 'green.png'), join(FIX, 'tiny.webp')])
  await page.getByTestId('dropzone').click()
  await expect(page.locator('.image-tile:not(.add)')).toHaveCount(2)
  await expect(page.locator('text=已忽略 1 个不支持的文件')).toBeVisible()
  // 图片缩略图确实加载出来
  await expect.poll(() => page.locator('.image-tile img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  const outDir = join(dir, 'images-out')
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, outDir)
  await page.locator('.output-box button', { hasText: '更改' }).click()
  await expect(page.locator('.output-box .path')).toContainText('images-out')
  await page.fill('input[aria-label="输出文件名"]', '我的照片')
  await shot('09-images')
  await page.locator('[data-action="run"]').click()
  await expect(page.getByTestId('result')).toBeVisible()
  const out = join(outDir, '我的照片.pdf')
  expect(await pageCount(out)).toBe(2)
  await writeFile(join(ROOT, 'test-results/images-output.pdf'), await readFile(out))
  // 恢复默认输出目录，避免影响其他用例
  await page.locator('button', { hasText: '继续处理' }).click()
  await page.locator('button', { hasText: '恢复为源文件所在文件夹' }).click()
  await page.locator('button[aria-label="返回"]').click()
  expect(basename(out)).toBe('我的照片.pdf')
})

test('拖入文件推荐工具', async () => {
  const a = await makePdf('推荐.pdf', 1, [0.3, 0.3, 0.3])
  await mockOpenDialog([a])
  await page.locator('.drop-hero').click()
  await expect(page.locator('.suggest-card')).toBeVisible()
  expect(await page.locator('.suggest-item').count()).toBeGreaterThanOrEqual(3)
  await shot('10-suggest')
  await page.locator('.suggest-item', { hasText: 'PDF 拆分' }).click()
  await expect(page.locator('.single-file h3')).toHaveText('推荐.pdf')
  await page.locator('button[aria-label="返回"]').click()
})
