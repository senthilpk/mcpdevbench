<script setup lang="ts">
import { Plus, RotateCw } from '@lucide/vue';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import Metric from '@/renderer/components/domain/Metric.vue';
import ServerTable from '@/renderer/components/domain/ServerTable.vue';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import AddServerSheet from '@/renderer/features/servers/AddServerSheet.vue';
import { useServerWorkspace } from '@/renderer/features/servers/use-server-workspace';
import type { SaveServerProfileInput } from '@/shared/domain/servers';

const workspace = useServerWorkspace();
const router = useRouter();
const addOpen = ref(false);
const saving = ref(false);
const actionError = ref<string>();
const signOutWarning = ref<string>();

async function save(input: SaveServerProfileInput): Promise<void> {
  saving.value = true;
  actionError.value = undefined;
  try { await workspace.save(input); addOpen.value = false; }
  catch { actionError.value = 'Unable to save the server profile'; }
  finally { saving.value = false; }
}
async function run(operation: () => Promise<void>): Promise<void> {
  actionError.value = undefined;
  signOutWarning.value = undefined;
  try { await operation(); } catch { actionError.value = 'Unable to complete the server action'; }
}
function confirmSignOut(serverName: string): boolean {
  return window.confirm(`Sign out of ${serverName}? This removes stored authorization; you'll need to reauthorize next time.`);
}
async function signOut(profileId: string): Promise<void> {
  const serverName = workspace.rows.value.find((row) => row.id === profileId)?.name ?? profileId;
  if (!confirmSignOut(serverName)) return;
  await run(async () => {
    const result = await workspace.signOut(profileId);
    if (result.warning) signOutWarning.value = `${serverName}: ${result.warning}`;
  });
}
function viewServer(profileId: string): void {
  void router.push(`/servers/${profileId}`);
}
</script>

<template>
  <section class="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
    <header class="flex items-start justify-between gap-6">
      <div><p class="mb-1 text-xs font-medium uppercase text-muted-foreground">Workspace</p><h2 class="text-2xl font-semibold">Servers</h2><p class="mt-1 max-w-2xl text-sm text-muted-foreground">Connect and discover local or remote MCP endpoints.</p></div>
      <Button @click="addOpen = true"><Plus /> Add server</Button>
    </header>
    <div class="mt-6 flex min-h-14 items-center border-y border-border py-3">
      <Metric label="Connected" :value="workspace.metrics.value.connected" /><Metric label="Tools" :value="workspace.metrics.value.tools" /><Metric label="Profiles" :value="workspace.metrics.value.profiles" />
    </div>
    <div v-if="workspace.error.value || actionError" role="alert" class="mt-6 flex items-center justify-between border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive">
      <span>{{ workspace.error.value || actionError }}</span><Button variant="outline" size="sm" @click="workspace.load"><RotateCw /> Retry</Button>
    </div>
    <div v-if="signOutWarning" role="status" class="mt-6 border border-warning/30 bg-card px-4 py-3 text-sm text-warning">{{ signOutWarning }}</div>
    <section class="mt-6" aria-labelledby="server-inventory-title">
      <div class="mb-3 flex items-center justify-between"><h3 id="server-inventory-title" class="text-sm font-semibold">Server inventory</h3><span class="font-mono text-xs text-muted-foreground">{{ workspace.profiles.value.length }} configured</span></div>
      <div v-if="workspace.loading.value" data-testid="server-loading" class="grid gap-2"><Skeleton class="h-10 w-full" /><Skeleton class="h-10 w-full" /><Skeleton class="h-10 w-full" /></div>
      <ServerTable
        v-else
        :servers="workspace.rows.value"
        @add="addOpen = true"
        @connect="run(() => workspace.connect($event))"
        @disconnect="run(() => workspace.disconnect($event))"
        @refresh="run(() => workspace.refresh($event))"
        @delete="run(() => workspace.remove($event))"
        @reopen-authorization="run(() => workspace.reopenAuthorization($event))"
        @cancel-authorization="run(() => workspace.cancelAuthorization($event))"
        @sign-out="signOut($event)"
        @view="viewServer($event)"
      />
    </section>
    <AddServerSheet v-model:open="addOpen" :pending="saving" @save="save" />
  </section>
</template>
