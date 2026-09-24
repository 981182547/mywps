# 轻匣 —— 文件处理工具箱

本地运行、免费、无水印的桌面文件处理工具。所有文件只在本机处理，不上传任何服务器。

## 功能一览（30 个工具）

### PDF 工具
| 工具 | 说明 |
| --- | --- |
| PDF 合并 | 拖动排序，每个文件可单独指定页码范围（`1-3,5`、`8-`、`5-1` 倒序） |
| PDF 拆分 | 按固定页数或自定义范围拆分，结果预览，多个文件自动放入文件夹 |
| 提取页面 | 挑出指定页面另存为新 PDF |
| 旋转 / 删除 / 排序页面 | 缩略图网格，多选、Shift 连选、奇偶页、拖动排序、倒序、撤销与快捷键 |
| 添加水印 | 中文文字或图片，字号/颜色/透明度/角度/平铺，实时预览 |
| 添加页码 | 六种位置、六种格式、起始页码、跳过封面，实时预览 |

### 格式转换
| 工具 | 说明 |
| --- | --- |
| PDF 转 Word | 重建标题、段落、对齐、缩进与图片，生成可编辑文档 |
| PDF 转 Excel | 按文字位置识别表格行列，数字转数值，保留编号前导零 |
| PDF 转 PPT / 图片 / 长图 / 文字 | 清晰度可选；长图超长自动分段；支持中文未嵌入字体的 PDF |
| Word / Excel / PPT 转 PDF | 批量转换；Excel 可每个工作表一页 |
| Office 格式转换 | doc↔docx、xls↔xlsx、ppt↔pptx，WPS 格式（wps/et/dps）转通用格式 |
| 图片转 PDF | 支持 HEIC（苹果照片）、WEBP 等，自动纠正照片方向 |

### 图片工具
格式转换（JPG/PNG/WEBP/AVIF/BMP/TIFF/ICO/GIF）、按清晰度或指定大小压缩（绝不越压越大）、调整尺寸（含证件照预设）。均支持批量。

### 安全与签名
- PDF 加密（AES-256，打开密码 + 打印/复制/编辑权限）、PDF 解密
- 签名与盖章：手写 / 文字签名、导入印章照片自动去白底、拖放放置、复制到所有页、骑缝章

### 压缩与修复
PDF 压缩（无损 / 标准 / 强力三档，安全地重新压缩图片）、PDF 修复（重建损坏文件结构）

### 文字识别（离线）
图片转文字（结果可一键复制）、扫描件转可搜索 PDF / Word / TXT

### 文件工具
批量重命名：模板、序号、日期、查找替换，实时预览与冲突提示，可撤销

## 可靠性设计

- **从不覆盖原文件**：默认保存在源文件旁边，重名自动编号；先写临时文件再改名，失败不留半成品
- **批量处理互不影响**：单个文件失败时继续处理其他文件，最后汇总失败原因
- **后台线程处理**：界面不卡顿，显示实时进度，可随时取消（包括外部转换进程）
- **明确的中文提示**：加密、损坏、格式不符都会说明原因与解决办法
- 只限制了权限（打开不需要密码）的 PDF 会自动解除限制后处理

## Office 转换需要的软件

Word/Excel/PPT 转 PDF 与 Office 格式转换需要电脑上有一个办公软件：

- Windows：优先使用已安装的 **Microsoft Office** 或 **WPS Office**
- 任何系统：也可以安装免费的 **[LibreOffice](https://www.libreoffice.org/download/download/)**

未安装时，程序会给出下载指引。其余功能都不需要额外软件。

## 开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev        # 开发模式启动
npm run build      # 构建
npm start          # 运行构建后的程序
```

## 测试

```bash
npm run check      # 类型检查 + 单元测试 + 端到端测试（提交前必须通过）
npm run typecheck
npm test           # 单元测试：处理引擎（含真实渲染验证位置、颜色、方向）
npm run test:e2e   # 端到端测试：启动真实程序，模拟用户操作每个工具
```

Linux 无显示器环境需要 `xvfb-run -a npm run check`。Office 相关测试需要安装 LibreOffice，未安装时自动跳过。

设置 `QX_APP_EXEC=<打包后的程序路径>` 可以对安装包版本运行同一套端到端测试。

## 打包

```bash
npm run dist:win     # Windows 安装版 + 便携版（在 Linux/macOS 上构建需要 wine）
npm run dist:mac
npm run dist:linux
```

推送代码后，GitHub Actions 会在 Linux 和 Windows 上分别运行全部测试，并在 Windows 上生成安装包（在 Actions 页面的 Artifacts 中下载）。

## 目录结构

```
src/
  main/              主进程
    engine/          处理引擎（纯 Node，可单独测试）
    worker.ts        后台工作线程
  preload/           预加载脚本
  renderer/          界面（React）
    src/tools/       各个工具页面与工具注册表
  shared/            主进程与界面共用的类型、页码解析、版面计算、重命名规则
tests/
  unit/              单元测试
  e2e/               端到端测试
  fixtures/          测试用文件
build/               应用图标
scripts/             图标生成、Windows 原生模块准备
```

## 已知限制

- Windows 上调用 Microsoft Office / WPS 的路径无法在 Linux 开发环境中测试，已实现自动回退到 LibreOffice
- PDF 转 Word/Excel 对多栏排版、复杂表格的还原有限，适合以文字和简单表格为主的文件
- 文字识别使用 tesseract，对手写体、低清晰度图片的识别率有限
