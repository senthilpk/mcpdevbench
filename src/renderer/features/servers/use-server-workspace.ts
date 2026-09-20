import { computed, onMounted, onUnmounted, readonly, ref } from 'vue';
import type { ConnectionState as StatusState } from '@/renderer/components/domain/ConnectionStatus.vue';
import type {
  AuthorizationSnapshot,
  CatalogSnapshot,
  ConnectionSnapshot,
  SaveServerProfileInput,
  ServerProfile,
  SignOutResult,
} from '@/shared/domain/servers';

export type ServerRow = {
  id: string;
  name: string;
  transport: 'STDIO' | 'HTTP';
  tools: number | '—';
  state: StatusState;
  connectionId?: string | undefined;
  failure?: string | undefined;
  catalogSummary?: string | undefined;
  authorization?: AuthorizationSnapshot | undefined;
};

const stateMap: Record<ConnectionSnapshot['state'], StatusState> = {
  connecting: 'connecting', initializing: 'connecting', discovering: 'connecting',
  ready: 'connected', closing: 'disconnecting', disconnected: 'idle', failed: 'error',
  'authorization-required': 'authorization-required', authorizing: 'authorizing', 'completing-authorization': 'completing-authorization',
};

export function useServerWorkspace() {
  const profiles = ref<ServerProfile[]>([]);
  const connections = ref<ConnectionSnapshot[]>([]);
  const loading = ref(true);
  const error = ref<string>();
  let unsubscribe: (() => void) | undefined;

  const rows = computed<ServerRow[]>(() => profiles.value.map((profile) => {
    const connection = [...connections.value].reverse().find((item) => item.profileId === profile.id);
    return {
      id: profile.id,
      name: profile.name,
      transport: profile.transport === 'stdio' ? 'STDIO' : 'HTTP',
      tools: connection?.tools.status === 'ready' ? connection.tools.items.length : '—',
      state: connection ? stateMap[connection.state] : 'idle',
      connectionId: connection?.connectionId,
      failure: connection?.failure?.message,
      catalogSummary: connection?.state === 'ready'
        ? catalogText(connection)
        : undefined,
      authorization: connection?.authorization,
    };
  }));

  const metrics = computed(() => ({
    connected: connections.value.filter((item) => item.state === 'ready').length,
    tools: connections.value.reduce((total, item) => total + (item.tools.status === 'ready' ? item.tools.items.length : 0), 0),
    profiles: profiles.value.length,
  }));

  async function load(): Promise<void> {
    loading.value = true;
    error.value = undefined;
    try {
      const [savedProfiles, activeConnections] = await Promise.all([
        window.mcpdevbench.listProfiles(),
        window.mcpdevbench.listConnections(),
      ]);
      profiles.value = savedProfiles;
      connections.value = activeConnections;
    } catch {
      error.value = 'Unable to load saved server profiles';
    } finally {
      loading.value = false;
    }
  }

  async function save(input: SaveServerProfileInput): Promise<void> {
    const profile = await window.mcpdevbench.saveProfile(input);
    profiles.value = [...profiles.value, profile];
  }

  const connect = async (profileId: string) => { await window.mcpdevbench.connect(profileId); };
  const disconnect = async (connectionId: string) => { await window.mcpdevbench.disconnect(connectionId); };
  const refresh = async (connectionId: string) => { await window.mcpdevbench.refresh(connectionId); };
  const reopenAuthorization = async (connectionId: string) => { await window.mcpdevbench.reopenAuthorization(connectionId); };
  const cancelAuthorization = async (connectionId: string) => { await window.mcpdevbench.cancelAuthorization(connectionId); };
  const signOut = async (profileId: string): Promise<SignOutResult> => window.mcpdevbench.signOut(profileId);
  const remove = async (profileId: string) => {
    await window.mcpdevbench.deleteProfile(profileId);
    profiles.value = profiles.value.filter((profile) => profile.id !== profileId);
  };

  onMounted(() => {
    unsubscribe = window.mcpdevbench.onConnectionsChanged((snapshots) => {
      connections.value = snapshots;
    });
    void load();
  });
  onUnmounted(() => unsubscribe?.());

  return {
    profiles: readonly(profiles), connections: readonly(connections), rows,
    loading: readonly(loading), error: readonly(error), metrics,
    load, save, connect, disconnect, refresh, remove,
    reopenAuthorization, cancelAuthorization, signOut,
  };
}

function catalogText(connection: ConnectionSnapshot): string {
  const count = <T>(catalog: CatalogSnapshot<T>) => catalog.status === 'ready' ? catalog.items.length : 0;
  return `${count(connection.resources)} resources · ${count(connection.resourceTemplates)} templates · ${count(connection.prompts)} prompts`;
}
