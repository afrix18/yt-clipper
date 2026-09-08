import { spawn, exec, ExecOptions } from 'child_process';
import * as crypto from 'crypto';
import type { CmdResult, LineHandler } from './types';

export function runCmd(cmd: string, options: ExecOptions = {}): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    exec(cmd, { ...options, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject({ error, stdout, stderr });
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export function generateId(): string {
  return crypto.randomBytes(6).toString('hex');
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function spawnProcess(
  command: string,
  args: string[],
  onStdoutLine?: LineHandler,
  onStderrLine?: LineHandler,
): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutData += text;
      if (onStdoutLine) {
        const lines = text.split(/[\r\n]+/);
        lines.forEach((line: string) => { if (line.trim()) onStdoutLine(line); });
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrData += text;
      if (onStderrLine) {
        const lines = text.split(/[\r\n]+/);
        lines.forEach((line: string) => { if (line.trim()) onStderrLine(line); });
      }
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) resolve({ stdout: stdoutData, stderr: stderrData });
      else reject(new Error(`Command exited with code ${code}: ${stderrData || stdoutData}`));
    });

    proc.on('error', (err: Error) => reject(err));
  });
}

// Helper to escape path for FFmpeg subtitles filter
export function escapeFfmpegPath(filepath: string): string {
  return filepath.replace(/\\/g, '/').replace(/:/g, '\\:');
}
