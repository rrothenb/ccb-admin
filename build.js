#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Clean dist directory
const distDir = './dist';
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir);

// Bundle the TypeScript code
esbuild.buildSync({
  entryPoints: ['./src/gas-entry.ts'],
  bundle: true,
  outfile: './dist/Code.js',
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
let bundled = fs.readFileSync('./dist/Code.js', 'utf8');

// Remove the IIFE wrapper
// The bundle is wrapped as: var __GAS_BUNDLE__ = (() => { ... })();
// We need to remove this wrapper and just keep the contents
const iiffeMatch = bundled.match(/var __GAS_BUNDLE__ = \(\(\) => \{\n([\s\S]*)\n\}\)\(\);/);
if (iiffeMatch) {
  bundled = '// Google Apps Script Bundle\n' + iiffeMatch[1];
  fs.writeFileSync('./dist/Code.js', bundled);
} else {
  console.error('Warning: Could not unwrap IIFE. Bundle may not work correctly.');
}

// Copy HTML files
const htmlFiles = fs.readdirSync('./src/ui/html').filter(f => f.endsWith('.html'));
htmlFiles.forEach(file => {
  fs.copyFileSync(
    path.join('./src/ui/html', file),
    path.join('./dist', file)
  );
});

// Copy manifest
fs.copyFileSync('./appsscript.json', './dist/appsscript.json');

console.log('✓ Build complete!');
console.log('  - Bundled TypeScript → dist/Code.js');
console.log(`  - Copied ${htmlFiles.length} HTML files`);
console.log('  - Copied appsscript.json');
