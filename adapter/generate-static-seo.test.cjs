'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// The Docker build runs this generator before Angular's localization compiler.
// The docs source now uses $localize, so the generator must still render English.
test('generates English SEO pages from localized documentation source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ltc-seo-build-'));
  try {
    const frontend = path.join(root, 'frontend');
    const sourceRoot = path.join(__dirname, '..', 'frontend');
    const config = require('./static-seo.config.json');
    const sources = new Set([
      config.docsData,
      'src/app/docs/api-docs/api-docs.component.html',
      'src/app/shared/components/tx-taxi-docs-intro/tx-taxi-docs-intro.component.html',
      'src/app/components/about/about.component.html',
      ...config.routes.map(route => route.source).filter(Boolean),
    ]);
    for (const file of sources) {
      const dest = path.join(frontend, file);
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      fs.copyFileSync(path.join(sourceRoot, file), dest);
    }
    fs.mkdirSync(path.join(frontend, 'src/app/shared'), {recursive: true});
    const output = path.join(root, 'pages.json');
    execFileSync(process.execPath, [path.join(__dirname, 'generate-static-seo.cjs'), frontend, output], {stdio: 'pipe'});
    const {pages} = JSON.parse(fs.readFileSync(output, 'utf8'));
    const page = name => pages.find(item => item.path === name).html;
    assert.match(page('/docs/api/rest'), /Returns the current Litecoin tip height as plain text/);
    assert.match(page('/docs/api/websocket'), /Connect to <code>\/api\/v1\/ws<\/code>/);
    assert.match(page('/docs/faq'), /Litecoin targets a block every 2\.5 minutes/);
    assert.match(page('/about'), /Litecoin explorer/);
    assert.match(page('/about'), /href="\/"/);
    assert.ok(pages.every(item => !item.html.includes(':@@')));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
