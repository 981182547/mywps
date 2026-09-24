// 在非 Windows 系统上构建 Windows 安装包前，下载与当前版本匹配的 Windows 原生模块
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

if (process.platform === 'win32') process.exit(0)
const require = createRequire(import.meta.url)
const sharp = require('sharp/package.json').optionalDependencies['@img/sharp-win32-x64']
const canvas = require('@napi-rs/canvas/package.json').optionalDependencies['@napi-rs/canvas-win32-x64-msvc']
execSync(`npm install --no-save --force @img/sharp-win32-x64@${sharp} @napi-rs/canvas-win32-x64-msvc@${canvas}`, { stdio: 'inherit' })
