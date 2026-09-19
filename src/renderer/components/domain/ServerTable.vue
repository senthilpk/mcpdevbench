<script lang="ts">
import type { ConnectionState } from '@/renderer/components/domain/ConnectionStatus.vue';

export type ServerSummary = {
  id: string;
  name: string;
  transport: 'STDIO' | 'HTTP';
  tools: number;
  state: ConnectionState;
};
</script>

<script setup lang="ts">
import ConnectionStatus from '@/renderer/components/domain/ConnectionStatus.vue';
import EmptyServerState from '@/renderer/components/domain/EmptyServerState.vue';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/renderer/components/ui/table';

defineProps<{ servers: ServerSummary[] }>();
</script>

<template>
  <EmptyServerState v-if="servers.length === 0" />
  <div v-else class="overflow-hidden rounded-md border border-border bg-card">
    <Table aria-label="Configured servers">
      <TableHeader>
        <TableRow class="bg-muted/60 hover:bg-muted/60">
          <TableHead>Server</TableHead>
          <TableHead>Transport</TableHead>
          <TableHead class="text-right">Tools</TableHead>
          <TableHead class="w-36">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="server in servers" :key="server.id">
          <TableCell class="font-medium">{{ server.name }}</TableCell>
          <TableCell class="font-mono text-xs text-muted-foreground">{{ server.transport }}</TableCell>
          <TableCell class="text-right font-mono tabular-nums">{{ server.tools }}</TableCell>
          <TableCell><ConnectionStatus :state="server.state" /></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
