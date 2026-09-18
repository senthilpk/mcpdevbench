import { vi } from 'vitest';

Object.defineProperty(window, 'mcpdevbench', {
  configurable: true,
  value: {
    getHealth: vi.fn().mockResolvedValue({
      status: 'ready',
      app: 'MCPDevBench',
    }),
  },
});
