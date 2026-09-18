import { z } from 'zod';
import type { HealthStatus } from '@/shared/domain/health';

export const healthChannels = { get: 'health:get' } as const;

export const healthStatusSchema: z.ZodType<HealthStatus> = z.object({
  status: z.literal('ready'),
  app: z.literal('MCPDevBench'),
});

export type HealthStatusContract = z.infer<typeof healthStatusSchema>;
