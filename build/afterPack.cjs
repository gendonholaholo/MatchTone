const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function collectMachOBinaries(dir, results = []) {
  if (!fs.existsSync(dir)) {
    return results;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      collectMachOBinaries(fullPath, results);
      continue;
    }
    if (
      entry.name === 'color-engine' ||
      entry.name.endsWith('.dylib') ||
      entry.name.endsWith('.so')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Ensures PyInstaller sidecar executable permissions and ad-hoc Mach-O signatures on macOS.
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName === 'darwin') {
    const appName = `${packager.appInfo.productFilename}.app`;
    const sidecarDir = path.join(appOutDir, appName, 'Contents', 'Resources', 'sidecar');
    const sidecarBin = path.join(sidecarDir, 'color-engine');

    if (fs.existsSync(sidecarBin)) {
      fs.chmodSync(sidecarBin, 0o755);
      const binaries = collectMachOBinaries(sidecarDir);
      for (const binPath of binaries) {
        if (binPath !== sidecarBin) {
          execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', binPath]);
        }
      }
      execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', sidecarBin]);
    }
    return;
  }

  if (electronPlatformName === 'linux') {
    const sidecarBin = path.join(appOutDir, 'resources', 'sidecar', 'color-engine');
    if (fs.existsSync(sidecarBin)) {
      fs.chmodSync(sidecarBin, 0o755);
    }
  }
};
