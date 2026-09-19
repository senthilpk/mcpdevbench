import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export type AuthorizationStorageMode = 'persistent' | 'session-only';

/** Stable across calls and instances so callers/tests can rely on the exact string. */
export const SESSION_ONLY_WARNING =
  'Secure storage is unavailable on this system; authorization will be kept only for this session and lost when MCPDevBench closes.';

export class OAuthStorageError extends Error {
  override readonly name = 'OAuthStorageError';
}

/** Matches Electron's `safeStorage`; see electron.d.ts for the ground-truth shape. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** @platform linux only -- must not be called on darwin/win32. */
  getSelectedStorageBackend?(): string;
}

export interface SecretStoreDependencies {
  safeStorage: SafeStorageLike;
  platform: NodeJS.Platform;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
}

/** The narrow surface `OAuthRecordStore` depends on; a real or fake `SecretStore` satisfies it. */
export interface SecretStoreLike {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}

const secretDocumentSchema = z.object({
  version: z.literal(1),
  ciphertext: z.string(),
}).strict();

export class SecretStore implements SecretStoreLike {
  private readonly mode: AuthorizationStorageMode;
  private memoryValue: string | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly deps: SecretStoreDependencies) {
    this.mode = computeStorageMode(deps);
  }

  storageMode(): AuthorizationStorageMode {
    return this.mode;
  }

  sessionOnlyWarning(): string | undefined {
    return this.mode === 'session-only' ? SESSION_ONLY_WARNING : undefined;
  }

  async read(): Promise<string | undefined> {
    if (this.mode === 'session-only') return this.memoryValue;

    let raw: string;
    try {
      raw = await this.deps.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined;
      throw new OAuthStorageError('Unable to read OAuth secret storage', { cause: error });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new OAuthStorageError('OAuth secret storage file is corrupt', { cause: error });
    }

    const document = secretDocumentSchema.safeParse(parsedJson);
    if (!document.success) {
      throw new OAuthStorageError('OAuth secret storage file is corrupt', { cause: document.error });
    }

    try {
      return this.deps.safeStorage.decryptString(Buffer.from(document.data.ciphertext, 'base64'));
    } catch (error) {
      throw new OAuthStorageError('OAuth secret storage could not be decrypted', { cause: error });
    }
  }

  write(value: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.mode === 'session-only') {
        this.memoryValue = value;
        return;
      }

      const ciphertext = this.deps.safeStorage.encryptString(value).toString('base64');
      const document = secretDocumentSchema.parse({ version: 1, ciphertext });
      const temporaryPath = `${this.filePath}.tmp`;
      await this.deps.writeFile(temporaryPath, JSON.stringify(document), 'utf8');
      await this.deps.rename(temporaryPath, this.filePath);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function computeStorageMode(deps: SecretStoreDependencies): AuthorizationStorageMode {
  if (!deps.safeStorage.isEncryptionAvailable()) return 'session-only';
  if (deps.platform === 'linux' && deps.safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    return 'session-only';
  }
  return 'persistent';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Real Electron/Node-backed `SecretStore`; constructed by the Electron composition (Task 5). */
export class ElectronSecretStore extends SecretStore {
  constructor(filePath: string) {
    const { safeStorage } = require('electron') as typeof import('electron');
    super(filePath, {
      safeStorage,
      platform: process.platform,
      readFile: (path, encoding) => readFile(path, encoding),
      writeFile: (path, data, encoding) => writeFile(path, data, encoding),
      rename,
    });
  }
}
