<script setup lang="ts">
import { onMounted, ref } from 'vue';

const ready = ref(false);

onMounted(async () => {
  ready.value = (await window.mcpdevbench.getHealth()).status === 'ready';
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
        <span data-testid="app-status" class="status">
          {{ ready ? 'Ready' : 'Starting' }}
        </span>
      </div>
      <RouterView />
    </main>
  </div>
</template>
