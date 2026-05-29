import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-utils.js';

describe('formatBytes', () => {
  it('formats bytes, kilobytes, megabytes, and gigabytes with default precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB');
  });

  it('clamps negative and non-finite values to 0 B', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('supports configurable precision per unit', () => {
    expect(formatBytes(1536, { kbDecimals: 2 })).toBe('1.50 KB');
    expect(formatBytes(3.2 * 1024 ** 2, { mbDecimals: 3 })).toBe('3.200 MB');
    expect(formatBytes(1.25 * 1024 ** 3, { gbDecimals: 1 })).toBe('1.3 GB');
  });
});
