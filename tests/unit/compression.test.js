import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPRESSION, canRasterize, compressionGain, estimatedRasterBytes, hasTextLayer,
  isLikelyScan, isUsefulImage, isUsefulLossless, isUsefulRaster, nextQuality, pageTextChars,
  rasterScale, samplePageNumbers,
} from '../../public/compression-domain.js';

test('amostragem de páginas inclui começo e fim sem repetir', () => {
  assert.deepEqual(samplePageNumbers(0), []);
  assert.deepEqual(samplePageNumbers(3), [1, 2, 3]);
  const sample = samplePageNumbers(100, 8);
  assert.equal(sample.length, 8);
  assert.equal(sample[0], 1);
  assert.equal(sample.at(-1), 100);
  assert.equal(new Set(sample).size, sample.length);
  assert.deepEqual(sample, [...sample].sort((a, b) => a - b));
});

test('texto e digitalização usam a mesma amostra', () => {
  assert.equal(pageTextChars('  A  b\n c '), 'Abc'.length);
  assert.equal(isLikelyScan([0, 3, 10]), true);
  assert.equal(isLikelyScan([0, 3, 40]), false);
  assert.equal(isLikelyScan([]), false);
  assert.equal(hasTextLayer([0, 3, 40]), true);
  assert.equal(hasTextLayer([0, 3]), false);
});

test('ganho e limites separam compressão sem perda de rasterização', () => {
  assert.equal(compressionGain(1000, 700), 0.3);
  assert.equal(compressionGain(1000, 1000), 0);
  assert.equal(compressionGain(0, 100), 0);
  assert.equal(isUsefulLossless(100 * 1024, 90 * 1024), true);
  assert.equal(isUsefulLossless(100 * 1024, 99 * 1024), false);
  assert.equal(isUsefulLossless(100 * 1024, 95 * 1024), false);
  assert.equal(isUsefulRaster(10 * 1024 * 1024, 7 * 1024 * 1024), true);
  assert.equal(isUsefulRaster(10 * 1024 * 1024, 8.5 * 1024 * 1024), false);
  assert.equal(isUsefulImage(100 * 1024, 80 * 1024), true);
  assert.equal(isUsefulImage(100 * 1024, 95 * 1024), false);
});

test('escala de rasterização respeita DPI e teto de pixels', () => {
  assert.ok(Math.abs(rasterScale(612, 792) - COMPRESSION.scanDpi / 72) < 1e-9);
  assert.ok(Math.abs(rasterScale(5000, 5000) - COMPRESSION.maxRenderPixels / 5000) < 1e-9);
  assert.equal(estimatedRasterBytes(100 * 1024, 2), Math.round(100 * 1024 * 2 * 1.04));
});

test('rasterização só é oferecida para digitalização dentro do alvo', () => {
  assert.equal(canRasterize({ scan: true, pages: 2, estimatedBytes: 1024 }, 10 * 1024), true);
  assert.equal(canRasterize({ scan: false, pages: 2, estimatedBytes: 1024 }, 10 * 1024), false);
  assert.equal(canRasterize({ scan: true, pages: COMPRESSION.pdfPagesLimit + 1, estimatedBytes: 1024 }, 10 * 1024), false);
  assert.equal(canRasterize({ scan: true, pages: 2, estimatedBytes: 20 * 1024 }, 10 * 1024), false);
  assert.equal(nextQuality([0.9, 0.7, 0.5]), 0.9);
  assert.equal(nextQuality([0.9, 0.7, 0.5], 0.9), 0.7);
  assert.equal(nextQuality([0.9, 0.7, 0.5], 0.5), 0.5);
});
