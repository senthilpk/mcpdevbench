<script setup lang="ts">
import { Plug, RefreshCw, Trash2, Unplug } from '@lucide/vue';
import ConnectionStatus from '@/renderer/components/domain/ConnectionStatus.vue';
import EmptyServerState from '@/renderer/components/domain/EmptyServerState.vue';
import { Button } from '@/renderer/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import type { ServerRow } from '@/renderer/features/servers/use-server-workspace';

defineProps<{ servers: ServerRow[] }>();
defineEmits<{
  add: [];
  connect: [profileId: string];
  disconnect: [connectionId: string];
  refresh: [connectionId: string];
  delete: [profileId: string];
}>();
</script>

<template>
  <EmptyServerState v-if="servers.length === 0" @add="$emit('add')" />
  <div v-else class="overflow-hidden rounded-md border border-border bg-card">
    <Table aria-label="Configured servers">
      <TableHeader><TableRow class="bg-muted/60 hover:bg-muted/60">
        <TableHead>Server</TableHead><TableHead>Transport</TableHead><TableHead class="text-right">Tools</TableHead><TableHead class="w-36">Status</TableHead><TableHead class="w-40 text-right">Actions</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="server in servers" :key="server.id">
          <TableCell>
            <div class="font-medium">{{ server.name }}</div>
            <div v-if="server.failure" class="mt-1 max-w-72 text-xs text-destructive">{{ server.failure }}</div>
            <div v-else-if="server.catalogSummary" class="mt-1 text-xs text-muted-foreground">{{ server.catalogSummary }}</div>
          </TableCell>
          <TableCell class="font-mono text-xs text-muted-foreground">{{ server.transport }}</TableCell>
          <TableCell class="text-right font-mono tabular-nums">{{ server.tools }}</TableCell>
          <TableCell><ConnectionStatus :state="server.state" /></TableCell>
          <TableCell><div class="flex justify-end gap-1">
            <Button v-if="server.state === 'idle' || server.state === 'error'" size="icon-sm" variant="ghost" :aria-label="`Connect ${server.name}`" @click="$emit('connect', server.id)"><Plug /></Button>
            <template v-if="server.connectionId && server.state === 'connected'">
              <Button size="icon-sm" variant="ghost" :aria-label="`Refresh ${server.name}`" @click="$emit('refresh', server.connectionId)"><RefreshCw /></Button>
              <Button size="icon-sm" variant="ghost" :aria-label="`Disconnect ${server.name}`" @click="$emit('disconnect', server.connectionId)"><Unplug /></Button>
            </template>
            <Button size="icon-sm" variant="ghost" :aria-label="`Delete ${server.name}`" :disabled="server.state === 'connecting' || server.state === 'disconnecting'" @click="$emit('delete', server.id)"><Trash2 /></Button>
          </div></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
