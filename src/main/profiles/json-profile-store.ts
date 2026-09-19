import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ProfileStore } from '@/main/profiles/profile-store';
import { ProfileStoreError } from '@/main/profiles/profile-store';
import {
  saveServerProfileInputSchema,
  serverProfileSchema,
} from '@/shared/contracts/servers';
import type { SaveServerProfileInput, ServerProfile } from '@/shared/domain/servers';

const profileDocumentSchema = z.object({
  version: z.literal(1),
  profiles: z.array(serverProfileSchema),
}).strict();

export class JsonProfileStore implements ProfileStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<ServerProfile[]> {
    await this.mutationQueue;
    return this.readProfiles();
  }

  save(input: SaveServerProfileInput): Promise<ServerProfile> {
    const parsed = saveServerProfileInputSchema.parse(input);
    return this.enqueue(async () => {
      const profile = serverProfileSchema.parse({ ...parsed, id: randomUUID() });
      const profiles = await this.readProfiles();
      await this.writeProfiles([...profiles, profile]);
      return profile;
    });
  }

  delete(profileId: string): Promise<void> {
    return this.enqueue(async () => {
      const profiles = await this.readProfiles();
      const remaining = profiles.filter((profile) => profile.id !== profileId);
      if (remaining.length !== profiles.length) await this.writeProfiles(remaining);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readProfiles(): Promise<ServerProfile[]> {
    try {
      const source = await readFile(this.filePath, 'utf8');
      return profileDocumentSchema.parse(JSON.parse(source)).profiles;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw new ProfileStoreError('Unable to read saved server profiles', { cause: error });
    }
  }

  private async writeProfiles(profiles: ServerProfile[]): Promise<void> {
    const document = profileDocumentSchema.parse({ version: 1, profiles });
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
