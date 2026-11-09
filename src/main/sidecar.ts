import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app } from 'electron';
import { logMain } from './logger';

interface ResolvedCommand {
  command: string;
  args: string[];
  cwd: string;
}

export class SidecarManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private engineUrl = 'http://127.0.0.1:8765';
  private startPromise: Promise<string> | null = null;
  private stopping = false;

  public getUrl(): string {
    return this.engineUrl;
  }

  public async ensureStarted(): Promise<string> {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  private async startInternal(): Promise<string> {
    const externalUrl = process.env.MATCHTONE_ENGINE_URL?.trim();
    if (externalUrl) {
      this.engineUrl = externalUrl.replace(/\/+$/, '');
      logMain('info', 'sidecar.external_url', { engineUrl: this.engineUrl });
      await this.waitForHealth(this.engineUrl, 8000);
      return this.engineUrl;
    }

    const port = await allocateFreeLocalPort();
    this.engineUrl = `http://127.0.0.1:${port}`;
    const resolved = this.resolveSidecarExecutable(port);

    if (!resolved) {
      const fallbackPort = process.env.MATCHTONE_ENGINE_PORT?.trim() || '8765';
      this.engineUrl = `http://127.0.0.1:${fallbackPort}`;
      logMain('warn', 'sidecar.binary_not_found_using_fallback', {
        engineUrl: this.engineUrl,
      });
      return this.engineUrl;
    }

    logMain('info', 'sidecar.spawning', {
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      engineUrl: this.engineUrl,
    });

    const child = spawn(resolved.command, resolved.args, {
      cwd: resolved.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      windowsHide: true,
    });

    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        logMain('info', 'sidecar.stdout', { line: text });
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        logMain('warn', 'sidecar.stderr', { line: text });
      }
    });

    child.on('error', (err: Error) => {
      logMain('error', 'sidecar.process_error', { message: err.message });
    });

    child.on('exit', (code, signal) => {
      logMain('info', 'sidecar.exit', { code, signal, stopping: this.stopping });
      if (this.child === child) {
        this.child = null;
      }
    });

    await this.waitForHealth(this.engineUrl, 20000);
    logMain('info', 'sidecar.ready', { engineUrl: this.engineUrl, pid: child.pid });
    return this.engineUrl;
  }

  private resolveSidecarExecutable(port: number): ResolvedCommand | null {
    const binName = process.platform === 'win32' ? 'color-engine.exe' : 'color-engine';
    const baseArgs = ['--host', '127.0.0.1', '--port', String(port), '--watch-stdin'];

    if (app.isPackaged) {
      const packagedBin = path.join(process.resourcesPath, 'sidecar', binName);
      if (fs.existsSync(packagedBin)) {
        return {
          command: packagedBin,
          args: baseArgs,
          cwd: path.dirname(packagedBin),
        };
      }
      return null;
    }

    const appRoot = app.getAppPath();
    const engineDir = path.join(appRoot, 'color-engine');
    const venvPython =
      process.platform === 'win32'
        ? path.join(engineDir, '.venv', 'Scripts', 'python.exe')
        : path.join(engineDir, '.venv', 'bin', 'python');

    if (fs.existsSync(venvPython)) {
      return {
        command: venvPython,
        args: ['-m', 'color_engine', ...baseArgs],
        cwd: engineDir,
      };
    }

    const localBuiltBin = path.join(engineDir, 'dist', 'color-engine', binName);
    if (fs.existsSync(localBuiltBin)) {
      return {
        command: localBuiltBin,
        args: baseArgs,
        cwd: path.dirname(localBuiltBin),
      };
    }

    return null;
  }

  private async waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping) {
        return;
      }
      try {
        const res = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(1200),
        });
        if (res.ok) {
          const body = (await res.json()) as { ready?: boolean };
          if (body.ready) {
            return;
          }
        }
      } catch {
        // Sidecar is still booting.
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    logMain('warn', 'sidecar.health_timeout', { baseUrl, timeoutMs });
  }

  public stopSync(): void {
    this.stopping = true;
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = null;
    try {
      child.stdin.end();
    } catch {
      // Ignore already-closed stdin pipe.
    }
    try {
      child.kill('SIGTERM');
    } catch {
      // Process already exited.
    }
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = null;

    await new Promise<void>((resolve) => {
      const forceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already terminated.
        }
        resolve();
      }, 1500);

      child.once('exit', () => {
        clearTimeout(forceTimer);
        resolve();
      });

      try {
        child.stdin.end();
      } catch {
        // Ignore pipe close error.
      }
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(forceTimer);
        resolve();
      }
    });
  }
}

function allocateFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Failed to allocate localhost port')));
        return;
      }
      const { port } = addr;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}
