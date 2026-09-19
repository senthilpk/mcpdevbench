<script lang="ts">
export type ConnectionState = 'connected' | 'idle' | 'connecting' | 'disconnecting' | 'degraded' | 'error';
</script>

<script setup lang="ts">
import { CircleCheck, CirclePause, CircleX, LoaderCircle, TriangleAlert } from '@lucide/vue';
import { computed } from 'vue';
import { Badge } from '@/renderer/components/ui/badge';

const props = defineProps<{ state: ConnectionState }>();

const connectionStates = {
  connected: { label: 'Connected', className: 'text-success', icon: CircleCheck },
  idle: { label: 'Idle', className: 'text-muted-foreground', icon: CirclePause },
  connecting: { label: 'Connecting', className: 'text-info', icon: LoaderCircle },
  disconnecting: { label: 'Disconnecting', className: 'text-muted-foreground', icon: LoaderCircle },
  degraded: { label: 'Degraded', className: 'text-warning', icon: TriangleAlert },
  error: { label: 'Error', className: 'text-destructive', icon: CircleX },
} as const;

const status = computed(() => connectionStates[props.state]);
</script>

<template>
  <Badge
    variant="outline"
    role="status"
    :class="['gap-1.5 bg-transparent font-medium', status.className]"
  >
    <component :is="status.icon" :class="['size-3.5', (state === 'connecting' || state === 'disconnecting') && 'animate-spin']" aria-hidden="true" />
    {{ status.label }}
  </Badge>
</template>
