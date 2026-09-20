import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from '@/renderer/lib/format';

describe('formatBytes', () => {
  it('renders sub-1024 byte counts in B', () => {
    expect(formatBytes(41)).toBe('41 B');
  });

  it('renders sub-1MB counts in KB', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('renders 1MB and above in MB', () => {
    expect(formatBytes(1024 * 1024 + 1024 * 512)).toBe('1.5 MB');
  });
});

describe('formatDuration', () => {
  it('renders sub-1000ms durations in ms', () => {
    expect(formatDuration(624)).toBe('624 ms');
  });

  it('renders 1000ms and above in seconds', () => {
    expect(formatDuration(1500)).toBe('1.50 s');
  });
});
