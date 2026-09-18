import { describe, expect, it } from 'vitest';
import { getHealth } from '@/main/health/get-health';
import { healthStatusSchema } from '@/shared/contracts/health';

describe('getHealth', () => {
  it('returns a contract-valid ready status', () => {
    const result = getHealth();

    expect(healthStatusSchema.parse(result)).toEqual({
      status: 'ready',
      app: 'MCPDevBench',
    });
  });
});
