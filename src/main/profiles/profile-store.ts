import type { SaveServerProfileInput, ServerProfile } from '@/shared/domain/servers';

export interface ProfileStore {
  list(): Promise<ServerProfile[]>;
  save(input: SaveServerProfileInput): Promise<ServerProfile>;
  delete(profileId: string): Promise<void>;
}

export class ProfileStoreError extends Error {
  override readonly name = 'ProfileStoreError';
}
