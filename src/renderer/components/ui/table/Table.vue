<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useAttrs } from 'vue'
import { cn } from '@/renderer/lib/utils'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const attrs = useAttrs()
</script>

<template>
  <div data-slot="table-container" class="relative w-full overflow-x-auto">
    <table v-bind="attrs" data-slot="table" :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>
