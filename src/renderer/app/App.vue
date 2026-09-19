<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ApplicationState } from '@/renderer/components/domain/ApplicationStatus.vue';
import AppSidebar from '@/renderer/components/shell/AppSidebar.vue';
import AppToolbar from '@/renderer/components/shell/AppToolbar.vue';
import { SidebarInset, SidebarProvider } from '@/renderer/components/ui/sidebar';

const applicationState = ref<ApplicationState>('starting');

onMounted(async () => {
  try {
    applicationState.value = (await window.mcpdevbench.getHealth()).status === 'ready'
      ? 'ready'
      : 'unavailable';
  } catch {
    applicationState.value = 'unavailable';
  }
});
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="min-w-0 overflow-hidden">
      <AppToolbar :application-state="applicationState" />
      <div class="min-h-0 flex-1 overflow-auto"><RouterView /></div>
    </SidebarInset>
  </SidebarProvider>
</template>
