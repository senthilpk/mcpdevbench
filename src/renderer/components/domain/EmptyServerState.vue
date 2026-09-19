<script setup lang="ts">
import { Server } from '@lucide/vue';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/renderer/components/ui/empty';
</script>

<template>
  <Empty data-testid="empty-servers" class="min-h-56 border border-border bg-card">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Server aria-hidden="true" />
      </EmptyMedia>
      <EmptyTitle>No servers configured</EmptyTitle>
      <EmptyDescription>
        Add a local command or Streamable HTTP endpoint when server management is available.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
