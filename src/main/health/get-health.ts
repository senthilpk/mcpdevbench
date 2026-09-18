import type { HealthStatus } from '@/shared/domain/health';

export const getHealth = (): HealthStatus => ({
  status: 'ready',
  app: 'MCPDevBench',
});
