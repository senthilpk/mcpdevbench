import { vi } from 'vitest';

Object.defineProperty(window, 'mcpdevbench', {
  configurable: true,
  value: {
    getHealth: vi.fn().mockResolvedValue({
      status: 'ready',
      app: 'MCPDevBench',
    }),
    listProfiles: vi.fn().mockResolvedValue([]),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    onConnectionsChanged: vi.fn().mockReturnValue(vi.fn()),
  },
});
