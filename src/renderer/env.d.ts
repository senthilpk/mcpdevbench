/// <reference types="vite/client" />

import type { MCPDevBenchApi } from '@/preload/api';

declare global {
  interface Window {
    mcpdevbench: MCPDevBenchApi;
  }
}

export {};
