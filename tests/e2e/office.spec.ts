import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, WidthType } from 'docx'
import ExcelJS from 'exceljs'
import { close, launch, loadPdf, mockOpenDialog, openTool, shot, type Ctx } from './helpers'

test.describe('已安装办公软件', () => {
  let ctx: Ctx
  test.beforeAll(async () => {
    ctx = await launch()
  })
  test.afterAll(() => close(ctx))

  async function makeDocx(name: string, withTable = false): Promise<string> {
    const cell = (t: string) => new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph(t)] })
    const children: (Paragraph | Table)[] = [new Paragraph({ text: '项目进度报告', heading: HeadingLevel.HEADING_1 }), new Paragraph('本周完成了设计评审。')]
    if (withTable)
      children.push(
        new Table({
          columnWidths: [3000, 3000],
          rows: [
            new TableRow({ children: [cell('任务'), cell('进度')] }),
            new TableRow({ children: [cell('设计'), cell('100')] })
          ]
        })
      )
    const p = join(ctx.dir, name)
    await writeFile(p, await Packer.toBuffer(new Document({ sections: [{ children }] })))
    return p
  }

  test('Word 转 PDF：批量', async () => {
    const { page, dir } = ctx
    const a = await makeDocx('周报.docx')
    const b = await makeDocx('月报.docx')
    await openTool(ctx, 'word-to-pdf')
    await expect(page.getByTestId('engine-ok')).toContainText('LibreOffice')
    await mockOpenDialog(ctx, [a, b])
    await page.getByTestId('dropzone').click()
    await expect(page.locator('.doc-row')).toHaveCount(2)
    await shot(ctx, '25-word-to-pdf')
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 90000 })
    expect((await loadPdf(join(dir, '周报.pdf'))).getPageCount()).toBeGreaterThan(0)
    expect(existsSync(join(dir, '月报.pdf'))).toBe(true)
  })

  test('Excel 转 PDF：每个工作表一页', async () => {
    const { page, dir } = ctx
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('数据')
    for (let i = 0; i < 30; i++) ws.addRow(Array.from({ length: 20 }, (_, j) => `R${i}C${j}`))
    const x = join(dir, '宽表.xlsx')
    await wb.xlsx.writeFile(x)
    await openTool(ctx, 'excel-to-pdf')
    await mockOpenDialog(ctx, [x])
    await page.getByTestId('dropzone').click()
    await page.locator('.toggle', { hasText: '每个工作表导出为一页' }).click()
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 90000 })
    expect((await loadPdf(join(dir, '宽表.pdf'))).getPageCount()).toBe(1)
  })

  test('Office 格式转换：docx → doc', async () => {
    const { page, dir } = ctx
    const a = await makeDocx('合同.docx')
    await openTool(ctx, 'office-convert')
    await mockOpenDialog(ctx, [a])
    await page.getByTestId('dropzone').click()
    await page.locator('.segmented button', { hasText: '旧版格式' }).click()
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 90000 })
    expect(existsSync(join(dir, '合同.doc'))).toBe(true)
  })

  test('PDF 转 Word 与 PDF 转 Excel', async () => {
    const { page, dir } = ctx
    const src = await makeDocx('进度表.docx', true)
    await openTool(ctx, 'word-to-pdf')
    await mockOpenDialog(ctx, [src])
    await page.getByTestId('dropzone').click()
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 90000 })
    const pdf = join(dir, '进度表.pdf')

    await openTool(ctx, 'pdf-to-word')
    await mockOpenDialog(ctx, [pdf])
    await page.getByTestId('dropzone').click()
    await mockOpenDialog(ctx, [join(dir, 'word')])
    await page.locator('.output-box button', { hasText: '更改' }).click()
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 60000 })
    expect(existsSync(join(dir, 'word', '进度表.docx'))).toBe(true)
    await page.locator('button', { hasText: '继续处理' }).click()
    await page.locator('button', { hasText: '恢复为源文件所在文件夹' }).click()

    await openTool(ctx, 'pdf-to-excel')
    await mockOpenDialog(ctx, [pdf])
    await page.getByTestId('dropzone').click()
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('result')).toBeVisible({ timeout: 60000 })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(join(dir, '进度表.xlsx'))
    const values = wb.worksheets[0].getSheetValues().flat().filter((v) => v !== undefined && v !== null && v !== '')
    expect(values).toContain('任务')
    expect(values).toContain(100)
  })
})

test.describe('未安装办公软件', () => {
  let ctx: Ctx
  test.beforeAll(async () => {
    ctx = await launch({ QX_OFFICE_DISABLED: '1' })
  })
  test.afterAll(() => close(ctx))

  test('给出安装 LibreOffice 的指引，按钮不可用', async () => {
    const { page } = ctx
    await openTool(ctx, 'ppt-to-pdf')
    await expect(page.getByTestId('engine-missing')).toBeVisible()
    await expect(page.getByTestId('engine-missing')).toContainText('下载 LibreOffice')
    await shot(ctx, '26-office-missing')
  })
})
