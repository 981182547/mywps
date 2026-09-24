import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

export const ROOT = join(__dirname, '../..')
export const FIX = join(ROOT, 'tests/fixtures')
export const SHOTS = join(ROOT, 'test-results/screens')

export interface Ctx {
  app: ElectronApplication
  page: Page
  dir: string
}

export async function launch(extraEnv: Record<string, string> = {}): Promise<Ctx> {
  const dir = await mkdtemp(join(tmpdir(), 'qx-e2e-'))
  const app = await electron.launch({ args: [ROOT, '--no-sandbox'], env: { ...process.env, ELECTRON_RENDERER_URL: '', ...extraEnv } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 800 })
  await app.evaluate(({ shell }) => {
    shell.openPath = async () => ''
    shell.showItemInFolder = () => {}
  })
  await page.waitForSelector('text=今天要处理什么文件？')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=今天要处理什么文件？')
  return { app, page, dir }
}

export async function close(ctx: Ctx | undefined): Promise<void> {
  if (!ctx) return
  await ctx.app.close()
  await rm(ctx.dir, { recursive: true, force: true })
}

/** 生成带页码文字的测试 PDF */
export async function makePdf(dir: string, name: string, pages: number, color: [number, number, number] = [0.39, 0.4, 0.96], rotate = 0): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842])
    p.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: rgb(...color) })
    p.drawText(`Page ${i}`, { x: 50, y: 600, size: 60, font })
    for (let l = 0; l < 12; l++) p.drawRectangle({ x: 50, y: 520 - l * 30, width: 400 - (l % 3) * 60, height: 10, color: rgb(0.85, 0.87, 0.9) })
    if (rotate) p.setRotation(degrees(rotate))
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

export async function loadPdf(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(path))
}

/** 让“打开文件/文件夹”对话框直接返回指定路径 */
export async function mockOpenDialog(ctx: Ctx, paths: string[]): Promise<void> {
  await ctx.app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog
  }, paths)
}

export async function shot(ctx: Ctx, name: string): Promise<void> {
  await ctx.page.waitForTimeout(400)
  await ctx.page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

export async function openTool(ctx: Ctx, id: string): Promise<void> {
  await ctx.page.locator('button[aria-label="返回"]').click({ timeout: 500 }).catch(() => undefined)
  await ctx.page.locator(`[data-tool="${id}"]`).first().click()
}
