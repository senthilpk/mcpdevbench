<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
}>();
</script>

<template>
  <div class="min-w-28 border-l border-border px-4 py-1 first:border-l-0 first:pl-0">
    <div class="font-mono text-lg font-semibold tabular-nums text-foreground">{{ value }}</div>
    <div class="mt-0.5 text-xs text-muted-foreground">{{ label }}</div>
  </div>
</template>
