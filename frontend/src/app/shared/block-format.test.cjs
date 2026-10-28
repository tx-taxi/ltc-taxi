'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('block values use the page language without losing precision', async () => {
  await import('@angular/localize/init');
  const {loadTranslations, clearTranslations} = await import('@angular/localize');
  const source = fs.readFileSync(path.join(__dirname, 'block-format.ts'), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const document = {documentElement: {lang: 'en-US'}};
  const context = {exports: {}, $localize: globalThis.$localize, Number, Math, BigInt, String, document};
  vm.runInNewContext(js, context);
  const f = context.exports;
  try {
    assert.equal(f.compactBlockNumber(1.23), '1.23');
    assert.equal(f.compactBlockNumber(1234.5), '1.23k');
    assert.equal(f.compactBlockNumber(0.00001), '<0.001');
    assert.equal(f.blockValueDetails(123456, 1.25, 0.5, 12.75), 'Total fees: 0.00123456 LTC. Median fee rate: 1.25 lit/vB. Fee range: 0.5–12.75 lit/vB.');
    document.documentElement.lang = 'es';
    loadTranslations({'taxi.ltc.block.details': 'Comisiones totales: {$fees} {$symbol}. Tasa de comisión mediana: {$median} {$feeUnit}. Rango de comisiones: {$min}–{$max} {$rangeUnit}.'});
    assert.equal(f.compactBlockNumber(1.23), '1,23');
    assert.equal(f.compactBlockNumber(1234.5), '1,23k');
    assert.equal(f.compactBlockNumber(0.00001), '<0,001');
    assert.equal(f.compactBlockNumber(-0.00001), '>−0,001');
    assert.equal(f.blockValueDetails(123456, 1.25, 0.5, 12.75), 'Comisiones totales: 0,00123456 LTC. Tasa de comisión mediana: 1,25 lit/vB. Rango de comisiones: 0,5–12,75 lit/vB.');
  } finally { clearTranslations(); }
});
