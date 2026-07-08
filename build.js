#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Build targets. Each Apps Script project is a separate bundle with its own
// entry point, output dir, HTML dir, and manifest. `main` is the public web
// app; `admin` is the master-account-only sync/contacts companion project.
// Usage: `node build.js [main|admin]` (defaults to main).
// ---------------------------------------------------------------------------
const TARGETS = {
  main: {
    entry: './src/gas-entry.ts',
    outDir: './dist',
    htmlDir: './src/ui/html',
    manifest: './appsscript.json',
  },
  admin: {
    entry: './src/admin-entry.ts',
    outDir: './dist-admin',
    htmlDir: './src/admin/html',
    manifest: './appsscript.admin.json',
  },
};

const target = process.argv[2] || 'main';
const cfg = TARGETS[target];
if (!cfg) {
  console.error(`Unknown build target "${target}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

// Clean output directory
if (fs.existsSync(cfg.outDir)) {
  fs.rmSync(cfg.outDir, { recursive: true });
}
fs.mkdirSync(cfg.outDir);

const outfile = path.join(cfg.outDir, 'Code.js');

// Bundle the TypeScript code
esbuild.buildSync({
  entryPoints: [cfg.entry],
  bundle: true,
  outfile,
  platform: 'neutral',
  target: 'es2019',
  format: 'iife',
  globalName: '__GAS_BUNDLE__',
  banner: {
    js: '// Google Apps Script Bundle\n',
  },
});

// Google Apps Script needs functions in global scope
// Read the bundled file and unwrap the IIFE
let bundled = fs.readFileSync(outfile, 'utf8');

// Remove the IIFE wrapper
// The bundle is wrapped as: var __GAS_BUNDLE__ = (() => { ... })();
// We need to remove this wrapper and just keep the contents
const iiffeMatch = bundled.match(/var __GAS_BUNDLE__ = \(\(\) => \{\n([\s\S]*)\n\}\)\(\);/);
if (iiffeMatch) {
  bundled = '// Google Apps Script Bundle\n' + iiffeMatch[1];
  fs.writeFileSync(outfile, bundled);
} else {
  console.error('Warning: Could not unwrap IIFE. Bundle may not work correctly.');
}

// Copy HTML files (may be absent for a bare target)
let htmlFiles = [];
if (fs.existsSync(cfg.htmlDir)) {
  htmlFiles = fs.readdirSync(cfg.htmlDir).filter(f => f.endsWith('.html'));
  htmlFiles.forEach(file => {
    fs.copyFileSync(path.join(cfg.htmlDir, file), path.join(cfg.outDir, file));
  });
}

// Copy manifest
fs.copyFileSync(cfg.manifest, path.join(cfg.outDir, 'appsscript.json'));

console.log(`✓ Build complete! (target: ${target})`);
console.log(`  - Bundled ${cfg.entry} → ${outfile}`);
console.log(`  - Copied ${htmlFiles.length} HTML files from ${cfg.htmlDir}`);
console.log(`  - Copied ${cfg.manifest} → ${path.join(cfg.outDir, 'appsscript.json')}`);
