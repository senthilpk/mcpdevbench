import { describe, expect, it, vi } from 'vitest';
import {
  OAuthStorageError,
  SecretStore,
  SESSION_ONLY_WARNING,
  type SecretStoreDependencies,
} from '@/main/oauth/secret-store';

const SAMPLE_ACCESS_TOKEN = 'sample-access-token-should-never-appear-in-plaintext';
const SAMPLE_VERIFIER = 'sample-pkce-verifier-should-never-appear-in-plaintext';

function fakeFileSystem() {
  const files = new Map<string, string>();
  const readFile = vi.fn(async (path: string) => {
    const contents = files.get(path);
    if (contents === undefined) {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    return contents;
  });
  const writeFile = vi.fn(async (path: string, data: string) => {
    files.set(path, data);
  });
  const rename = vi.fn(async (from: string, to: string) => {
    const data = files.get(from);
    if (data === undefined) throw new Error(`no such file: ${from}`);
    files.delete(from);
    files.set(to, data);
  });
  return { files, readFile, writeFile, rename };
}

/** Reversible fake that never leaks the plaintext substring verbatim into its output. */
function fakeSafeStorage(overrides: Partial<SecretStoreDependencies['safeStorage']> = {}) {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plainText: string) =>
      Buffer.from(`ENC:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8')),
    decryptString: vi.fn((encrypted: Buffer) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('ENC:')) throw new Error('bad ciphertext');
      return Buffer.from(text.slice('ENC:'.length), 'base64').toString('utf8');
    }),
    getSelectedStorageBackend: vi.fn(() => {
      throw new Error('getSelectedStorageBackend must only be called on linux');
    }),
    ...overrides,
  };
}

function makeDeps(over: Partial<SecretStoreDependencies> = {}): SecretStoreDependencies {
  const fs = fakeFileSystem();
  return {
    safeStorage: fakeSafeStorage(),
    platform: 'darwin',
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rename: fs.rename,
    ...over,
  };
}

describe('SecretStore', () => {
  it('round-trips an encrypted value through atomic write and read', async () => {
    const deps = makeDeps();
    const store = new SecretStore('/oauth/secrets.json', deps);

    await store.write(JSON.stringify({ accessToken: SAMPLE_ACCESS_TOKEN }));

    expect(store.storageMode()).toBe('persistent');
    expect(deps.writeFile).toHaveBeenCalledWith('/oauth/secrets.json.tmp', expect.any(String), 'utf8');
    expect(deps.rename).toHaveBeenCalledWith('/oauth/secrets.json.tmp', '/oauth/secrets.json');

    const reloaded = await new SecretStore('/oauth/secrets.json', deps).read();
    expect(JSON.parse(reloaded ?? '')).toEqual({ accessToken: SAMPLE_ACCESS_TOKEN });
  });

  it('returns undefined for a missing file instead of throwing', async () => {
    const deps = makeDeps();
    const store = new SecretStore('/oauth/secrets.json', deps);

    await expect(store.read()).resolves.toBeUndefined();
  });

  it('never writes the plaintext token or verifier to disk', async () => {
    const fs = fakeFileSystem();
    const deps = makeDeps({ readFile: fs.readFile, writeFile: fs.writeFile, rename: fs.rename });
    const store = new SecretStore('/oauth/secrets.json', deps);

    await store.write(JSON.stringify({ accessToken: SAMPLE_ACCESS_TOKEN, verifier: SAMPLE_VERIFIER }));

    const [, rawBytesWritten] = fs.writeFile.mock.calls[0] as [string, string];
    expect(rawBytesWritten).not.toContain(SAMPLE_ACCESS_TOKEN);
    expect(rawBytesWritten).not.toContain(SAMPLE_VERIFIER);
    expect(fs.files.get('/oauth/secrets.json')).not.toContain(SAMPLE_ACCESS_TOKEN);
    expect(fs.files.get('/oauth/secrets.json')).not.toContain(SAMPLE_VERIFIER);

    const parsedEnvelope = JSON.parse(fs.files.get('/oauth/secrets.json') ?? '{}');
    expect(parsedEnvelope).toEqual({ version: 1, ciphertext: expect.any(String) });
  });

  it('surfaces corrupt ciphertext as OAuthStorageError instead of empty data', async () => {
    const fs = fakeFileSystem();
    fs.files.set('/oauth/secrets.json', JSON.stringify({ version: 1, ciphertext: 'not-valid-ciphertext' }));
    const deps = makeDeps({ readFile: fs.readFile, writeFile: fs.writeFile, rename: fs.rename });
    const store = new SecretStore('/oauth/secrets.json', deps);

    await expect(store.read()).rejects.toBeInstanceOf(OAuthStorageError);
  });

  it('surfaces a malformed on-disk document as OAuthStorageError', async () => {
    const fs = fakeFileSystem();
    fs.files.set('/oauth/secrets.json', '{not json');
    const deps = makeDeps({ readFile: fs.readFile, writeFile: fs.writeFile, rename: fs.rename });
    const store = new SecretStore('/oauth/secrets.json', deps);

    await expect(store.read()).rejects.toBeInstanceOf(OAuthStorageError);
  });

  it('falls back to in-memory session-only storage when encryption is unavailable', async () => {
    const fs = fakeFileSystem();
    const deps = makeDeps({
      safeStorage: fakeSafeStorage({ isEncryptionAvailable: vi.fn(() => false) }),
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rename: fs.rename,
    });
    const store = new SecretStore('/oauth/secrets.json', deps);

    expect(store.storageMode()).toBe('session-only');
    expect(store.sessionOnlyWarning()).toBe(SESSION_ONLY_WARNING);

    await store.write('some-value');
    await expect(store.read()).resolves.toBe('some-value');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('treats a linux basic_text backend as session-only', async () => {
    const deps = makeDeps({
      platform: 'linux',
      safeStorage: fakeSafeStorage({ getSelectedStorageBackend: vi.fn(() => 'basic_text') }),
    });
    const store = new SecretStore('/oauth/secrets.json', deps);

    expect(store.storageMode()).toBe('session-only');
    expect(store.sessionOnlyWarning()).toBe(SESSION_ONLY_WARNING);
  });

  it('persists on linux when a secure backend is selected', async () => {
    const deps = makeDeps({
      platform: 'linux',
      safeStorage: fakeSafeStorage({ getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret') }),
    });
    const store = new SecretStore('/oauth/secrets.json', deps);

    expect(store.storageMode()).toBe('persistent');
    expect(store.sessionOnlyWarning()).toBeUndefined();
  });

  it('gives the same session-only warning string every time', () => {
    const store1 = new SecretStore('/a.json', makeDeps({ safeStorage: fakeSafeStorage({ isEncryptionAvailable: vi.fn(() => false) }) }));
    const store2 = new SecretStore('/b.json', makeDeps({ safeStorage: fakeSafeStorage({ isEncryptionAvailable: vi.fn(() => false) }) }));

    expect(store1.sessionOnlyWarning()).toBe(store2.sessionOnlyWarning());
  });
});
