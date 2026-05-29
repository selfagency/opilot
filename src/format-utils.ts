export interface FormatBytesOptions {
  gbDecimals?: number;
  kbDecimals?: number;
  mbDecimals?: number;
}

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;

/** Format bytes as a human-readable string (e.g. "3.72 GB"). */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const { kbDecimals = 1, mbDecimals = 1, gbDecimals = 2 } = options;

  if (!Number.isFinite(bytes)) {
    return '0 B';
  }

  if (bytes < KB) {
    return `${Math.max(0, Math.floor(bytes))} B`;
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(kbDecimals)} KB`;
  }
  if (bytes < GB) {
    return `${(bytes / MB).toFixed(mbDecimals)} MB`;
  }
  return `${(bytes / GB).toFixed(gbDecimals)} GB`;
}
