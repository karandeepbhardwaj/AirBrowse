#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createWriteStream } = require('fs');
const archiver = require('archiver');

// ── Colors ──────────────────────────────────────────────────────────────────
const color = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function info(msg) {
  console.log(`${color.cyan}[info]${color.reset} ${msg}`);
}
function success(msg) {
  console.log(`${color.green}[done]${color.reset} ${msg}`);
}
function warn(msg) {
  console.log(`${color.yellow}[warn]${color.reset} ${msg}`);
}
function fail(msg) {
  console.error(`${color.red}[fail]${color.reset} ${msg}`);
}

function run(cmd, cwd) {
  info(`Running: ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (err) {
    fail(`Command failed: ${cmd}`);
    process.exit(1);
  }
}

// ── Paths ───────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const VSCODE_DIR = path.join(ROOT, 'vscode-extension');
const BROWSER_DIR = path.join(ROOT, 'browser-extension');
const DIST_DIR = path.join(ROOT, 'dist');

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${color.bold}AirBrowse — Package All${color.reset}\n`);

  // 1. Clean / create dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  success('Cleaned dist/ directory');

  // 2. Install dependencies
  info('Installing dependencies...');
  run('npm install', ROOT);
  success('Dependencies installed');

  // 3. Compile TypeScript
  info('Compiling TypeScript...');
  run('npx tsc -p tsconfig.json', VSCODE_DIR);
  success('TypeScript compiled');

  // 4. Bundle with webpack
  info('Bundling with webpack...');
  run('npx webpack --mode production', VSCODE_DIR);
  success('Webpack bundle created');

  // 5. Package VS Code extension as .vsix
  info('Packaging .vsix...');
  run('npx @vscode/vsce package --no-dependencies', VSCODE_DIR);

  // Move .vsix to dist/
  const vsixFiles = fs.readdirSync(VSCODE_DIR).filter(f => f.endsWith('.vsix'));
  if (vsixFiles.length === 0) {
    fail('No .vsix file produced');
    process.exit(1);
  }
  for (const file of vsixFiles) {
    const src = path.join(VSCODE_DIR, file);
    const dest = path.join(DIST_DIR, file);
    fs.renameSync(src, dest);
    success(`Moved ${file} to dist/`);
  }

  // 6. Zip browser extension
  info('Zipping browser extension...');
  await zipDirectory(BROWSER_DIR, path.join(DIST_DIR, 'airbrowse-chrome.zip'));
  success('Browser extension zipped');

  // Done
  console.log(`\n${color.bold}${color.green}Build complete!${color.reset}`);
  console.log(`Output files in ${DIST_DIR}/:\n`);
  for (const file of fs.readdirSync(DIST_DIR)) {
    const stats = fs.statSync(path.join(DIST_DIR, file));
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`  ${color.cyan}${file}${color.reset}  (${sizeKB} KB)`);
  }
  console.log();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    // Try archiver first, fall back to built-in zlib approach
    try {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const output = createWriteStream(outPath);

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    } catch {
      // Fallback: use system zip command
      warn('archiver not available, falling back to system zip');
      try {
        execSync(`zip -r "${outPath}" .`, { cwd: sourceDir, stdio: 'inherit' });
        resolve();
      } catch (err) {
        reject(new Error(`Failed to zip browser extension: ${err.message}`));
      }
    }
  });
}

main().catch(err => {
  fail(err.message);
  process.exit(1);
});
