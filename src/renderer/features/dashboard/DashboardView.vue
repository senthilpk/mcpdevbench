<script setup lang="ts">
import { Plus, Stethoscope } from '@lucide/vue';
import Metric from '@/renderer/components/domain/Metric.vue';
import ServerTable from '@/renderer/components/domain/ServerTable.vue';
import { Button } from '@/renderer/components/ui/button';
import { demonstrationMetrics, demonstrationServers } from '@/renderer/features/dashboard/server-fixtures';
</script>

<template>
  <section class="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
    <header class="flex items-start justify-between gap-6">
      <div>
        <p class="mb-1 text-xs font-medium uppercase text-muted-foreground">Workspace</p>
        <h2 class="text-2xl font-semibold">Servers</h2>
        <p class="mt-1 max-w-2xl text-sm text-muted-foreground">Local and remote MCP endpoints available to this workbench.</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="outline" disabled aria-describedby="add-server-unavailable">
          <Stethoscope aria-hidden="true" /> Run doctor
        </Button>
        <Button disabled aria-describedby="add-server-unavailable">
          <Plus aria-hidden="true" /> Add server
        </Button>
      </div>
      <p id="add-server-unavailable" class="sr-only">These commands will be available with connection setup.</p>
    </header>
    <div class="mt-6 flex min-h-14 items-center border-y border-border py-3">
      <Metric v-for="metric in demonstrationMetrics" :key="metric.label" :label="metric.label" :value="metric.value" />
    </div>
    <section class="mt-6" aria-labelledby="server-inventory-title">
      <div class="mb-3 flex items-center justify-between">
        <h3 id="server-inventory-title" class="text-sm font-semibold">Server inventory</h3>
        <span class="font-mono text-xs text-muted-foreground">4 configured</span>
      </div>
      <ServerTable :servers="demonstrationServers" />
    </section>
  </section>
</template>
