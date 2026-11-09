export type LogLevel = 'info' | 'warn' | 'error';

export function logMain(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    scope: 'electron-main',
    level,
    event,
    ...context,
  });
  if (level === 'error') {
    process.stderr.write(`${payload}\n`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}
