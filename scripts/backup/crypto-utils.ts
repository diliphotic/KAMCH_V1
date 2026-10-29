import fs from 'fs';
import crypto from 'crypto';

/**
 * Calculates SHA-256 checksum for a file using streaming to avoid memory overhead on large dumps.
 */
export async function calculateSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Verifies that a file's SHA-256 matches an expected checksum.
 */
export async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const actualChecksum = await calculateSha256(filePath);
  return actualChecksum.toLowerCase() === expectedChecksum.trim().toLowerCase();
}

/**
 * Formats byte counts into human-readable strings (e.g., "1.42 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
