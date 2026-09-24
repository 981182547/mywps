// 启动外部程序（LibreOffice、PowerShell），并登记进程号以便取消时结束
import { spawn } from 'node:child_process'

let register: (pid: number) => void = () => undefined

export function onChildProcess(fn: (pid: number) => void): void {
  register = fn
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function runChild(cmd: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      // 非 Windows 下单独成组，取消时可以连同子进程一起结束
      detached: process.platform !== 'win32',
      env: env ?? process.env
    })
    if (child.pid) register(child.pid)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* 进程已结束 */
    }
  }
}
