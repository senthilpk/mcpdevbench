<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/renderer/components/ui/sheet';
import type { SaveServerProfileInput } from '@/shared/domain/servers';

const props = withDefaults(defineProps<{ open: boolean; pending?: boolean }>(), { pending: false });
const emit = defineEmits<{
  'update:open': [open: boolean];
  save: [input: SaveServerProfileInput];
}>();

const name = ref('');
const transport = ref<'stdio' | 'streamable-http'>('stdio');
const command = ref('');
const args = ref('');
const cwd = ref('');
const url = ref('');

const validHttpUrl = computed(() => {
  try { return ['http:', 'https:'].includes(new URL(url.value).protocol); } catch { return false; }
});
const valid = computed(() => name.value.trim().length > 0 && (
  transport.value === 'stdio'
    ? /^\S+$/.test(command.value.trim())
    : validHttpUrl.value
));

watch(() => props.open, (open) => {
  if (!open) return;
  name.value = ''; transport.value = 'stdio'; command.value = ''; args.value = ''; cwd.value = ''; url.value = '';
});

function submit(): void {
  if (!valid.value || props.pending) return;
  if (transport.value === 'stdio') {
    emit('save', {
      name: name.value.trim(), transport: 'stdio', command: command.value.trim(),
      args: args.value.split('\n').map((value) => value.trim()).filter(Boolean),
      ...(cwd.value.trim() ? { cwd: cwd.value.trim() } : {}),
    });
  } else {
    emit('save', { name: name.value.trim(), transport: 'streamable-http', url: url.value.trim() });
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent class="w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Add server</SheetTitle>
        <SheetDescription>Save a non-secret MCP connection profile.</SheetDescription>
      </SheetHeader>
      <form class="flex flex-1 flex-col gap-4 overflow-auto px-4" @submit.prevent="submit">
        <label class="grid gap-1.5 text-sm font-medium">Name<Input v-model="name" name="name" autocomplete="off" /></label>
        <label class="grid gap-1.5 text-sm font-medium">Transport
          <select v-model="transport" name="transport" class="h-9 rounded-md border border-input bg-background px-2.5">
            <option value="stdio">STDIO</option><option value="streamable-http">Streamable HTTP</option>
          </select>
        </label>
        <template v-if="transport === 'stdio'">
          <label class="grid gap-1.5 text-sm font-medium">Command<Input v-model="command" name="command" placeholder="node" autocomplete="off" /></label>
          <label class="grid gap-1.5 text-sm font-medium">Arguments
            <textarea v-model="args" name="args" rows="4" placeholder="One argument per line" class="rounded-md border border-input bg-background px-2.5 py-2 font-mono text-sm" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium">Working directory <span class="text-xs font-normal text-muted-foreground">Optional</span><Input v-model="cwd" name="cwd" autocomplete="off" /></label>
        </template>
        <label v-else class="grid gap-1.5 text-sm font-medium">MCP endpoint URL<Input v-model="url" name="url" type="url" placeholder="https://example.com/mcp" /></label>
        <p class="text-xs text-muted-foreground">Authentication, headers, and environment variables are not stored in this release.</p>
        <SheetFooter class="mt-auto px-0 pb-4">
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!valid || pending">{{ pending ? 'Saving...' : 'Save server' }}</Button>
        </SheetFooter>
      </form>
    </SheetContent>
  </Sheet>
</template>
