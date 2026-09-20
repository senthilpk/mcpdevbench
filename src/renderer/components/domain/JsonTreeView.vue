<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronRight } from '@lucide/vue';

const props = withDefaults(defineProps<{ data: unknown; depth?: number }>(), {
  depth: 0,
});

const isArray = computed(() => Array.isArray(props.data));
const isContainer = computed(() => props.data !== null && typeof props.data === 'object');
const entries = computed<Array<[string, unknown]>>(() => {
  if (!isContainer.value) return [];
  if (isArray.value) return (props.data as unknown[]).map((value, index) => [String(index), value]);
  return Object.entries(props.data as Record<string, unknown>);
});

const expanded = ref(props.depth < 3);

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}
</script>

<template>
  <span v-if="!isContainer" class="break-words font-mono text-xs">{{ formatPrimitive(data) }}</span>
  <div v-else class="font-mono text-xs">
    <button
      type="button"
      class="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
      @click="expanded = !expanded"
    >
      <component :is="expanded ? ChevronDown : ChevronRight" class="size-3" aria-hidden="true" />
      <span>{{ isArray ? `Array(${entries.length})` : `Object(${entries.length})` }}</span>
    </button>
    <div v-if="expanded" class="ml-3 border-l border-border pl-2">
      <div v-for="[key, value] in entries" :key="key" class="py-0.5">
        <span class="text-muted-foreground">{{ key }}: </span>
        <JsonTreeView :data="value" :depth="depth + 1" />
      </div>
    </div>
  </div>
</template>
