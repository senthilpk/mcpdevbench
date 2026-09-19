<script lang="ts">
export type ApplicationState = 'starting' | 'ready' | 'unavailable';
</script>

<script setup lang="ts">
import { CircleCheck, CircleX, LoaderCircle } from '@lucide/vue';
import { computed } from 'vue';
import { Badge } from '@/renderer/components/ui/badge';

const props = defineProps<{ state: ApplicationState }>();

const applicationStates = {
  starting: { label: 'Starting', className: 'text-muted-foreground', icon: LoaderCircle },
  ready: { label: 'Ready', className: 'text-success', icon: CircleCheck },
  unavailable: { label: 'Unavailable', className: 'text-destructive', icon: CircleX },
} as const;

const status = computed(() => applicationStates[props.state]);
</script>

<template>
  <Badge
    variant="outline"
    role="status"
    :class="['gap-1.5 bg-card font-medium', status.className]"
  >
    <component
      :is="status.icon"
      :class="['size-3.5', state === 'starting' && 'animate-spin']"
      aria-hidden="true"
    />
    {{ status.label }}
  </Badge>
</template>
