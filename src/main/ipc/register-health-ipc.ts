import { ipcMain } from 'electron';
import { getHealth } from '@/main/health/get-health';
import {
  healthChannels,
  healthStatusSchema,
} from '@/shared/contracts/health';

export const registerHealthIpc = (): void => {
  ipcMain.handle(healthChannels.get, () => healthStatusSchema.parse(getHealth()));
};
