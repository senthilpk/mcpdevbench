import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonProfileStore } from '@/main/profiles/json-profile-store';

describe('JsonProfileStore', () => {
  let directory: string;
  let file: string;
  let store: JsonProfileStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mcpdevbench-profiles-'));
    file = join(directory, 'profiles.json');
    store = new JsonProfileStore(file);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists and reloads profiles without auto-generated secret fields', async () => {
    const saved = await store.save({
      name: 'Local', transport: 'stdio', command: 'node', args: ['server.mjs'],
    });
    expect((await new JsonProfileStore(file).list())[0]).toEqual(saved);
    expect(saved).not.toHaveProperty('env');
  });

  it('does not overwrite corrupt profile data', async () => {
    await writeFile(file, '{broken', 'utf8');
    await expect(store.list()).rejects.toThrow('Unable to read saved server profiles');
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });

  it('serializes concurrent saves without losing either profile', async () => {
    await Promise.all([
      store.save({ name: 'Local', transport: 'stdio', command: 'node', args: [] }),
      store.save({ name: 'Remote', transport: 'streamable-http', url: 'https://example.test/mcp' }),
    ]);
    expect(await store.list()).toHaveLength(2);
  });

  it('deletes a profile and leaves unknown identifiers unchanged', async () => {
    const saved = await store.save({ name: 'Local', transport: 'stdio', command: 'node', args: [] });
    await store.delete('missing');
    expect(await store.list()).toHaveLength(1);
    await store.delete(saved.id);
    expect(await store.list()).toEqual([]);
  });
});
