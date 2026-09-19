<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ApplicationStatus, {
  type ApplicationState,
} from '@/renderer/components/domain/ApplicationStatus.vue';

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
  <div class="app-shell">
    <aside class="sidebar">
      <h1>MCPDevBench</h1>
      <nav aria-label="Primary">
        <RouterLink to="/">Dashboard</RouterLink>
      </nav>
    </aside>
    <main class="workspace">
      <div class="topbar">
        <ApplicationStatus data-testid="app-status" :state="applicationState" />
      </div>
      <RouterView />
    </main>
  </div>
</template>
