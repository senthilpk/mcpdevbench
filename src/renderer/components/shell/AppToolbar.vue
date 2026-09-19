<script setup lang="ts">
import type { ApplicationState } from '@/renderer/components/domain/ApplicationStatus.vue';
import ApplicationStatus from '@/renderer/components/domain/ApplicationStatus.vue';
import { Separator } from '@/renderer/components/ui/separator';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';

defineProps<{ applicationState: ApplicationState }>();
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
    <SidebarTrigger aria-label="Toggle navigation" />
    <Separator orientation="vertical" class="h-5" />
    <div class="flex min-w-0 items-center gap-2 text-xs">
      <span class="text-muted-foreground">Workspace</span>
      <span aria-hidden="true" class="text-border">/</span>
      <span class="truncate font-medium">Servers</span>
    </div>
    <ApplicationStatus data-testid="app-status" class="ml-auto" :state="applicationState" />
  </header>
</template>
