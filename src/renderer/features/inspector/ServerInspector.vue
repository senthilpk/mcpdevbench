<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowLeft } from '@lucide/vue';
import JsonTreeView from '@/renderer/components/domain/JsonTreeView.vue';
import { Button } from '@/renderer/components/ui/button';
import { useServerWorkspace } from '@/renderer/features/servers/use-server-workspace';
import type { ToolCallResult, ToolSummary } from '@/shared/domain/servers';

type CallStatus = 'success' | 'tool-error' | 'call-failed';

const STATUS_LABEL: Record<CallStatus, string> = {
  success: 'Success',
  'tool-error': 'Tool error',
  'call-failed': 'Call failed',
};
const STATUS_DOT_CLASS: Record<CallStatus, string> = {
  success: 'bg-success',
  'tool-error': 'bg-warning',
  'call-failed': 'bg-destructive',
};

const props = defineProps<{ profileId: string }>();
const workspace = useServerWorkspace();

const profile = computed(() => workspace.profiles.value.find((item) => item.id === props.profileId));
const connection = computed(() => workspace.connections.value.find((item) => item.profileId === props.profileId));
const tools = computed(() =>
  connection.value?.tools.status === 'ready' ? connection.value.tools.items : []);

const selectedTool = ref<ToolSummary>();
const argumentsText = ref('{}');
const argumentsError = ref<string>();
const callPending = ref(false);
const callError = ref<string>();
const result = ref<ToolCallResult>();
const callDurationMs = ref<number>();
const callSizeBytes = ref<number>();
const callStatus = ref<CallStatus>();
const activeTab = ref<'structure' | 'raw'>('structure');
const copied = ref(false);
let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

function selectTool(tool: ToolSummary): void {
  selectedTool.value = tool;
  argumentsText.value = '{}';
  argumentsError.value = undefined;
  callError.value = undefined;
  result.value = undefined;
  callDurationMs.value = undefined;
  callSizeBytes.value = undefined;
  callStatus.value = undefined;
  activeTab.value = 'structure';
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function callTool(): Promise<void> {
  const tool = selectedTool.value;
  const connectionId = connection.value?.connectionId;
  if (!tool || !connectionId) return;
  argumentsError.value = undefined;
  callError.value = undefined;

  let parsedArguments: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argumentsText.value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Arguments must be a JSON object');
    }
    parsedArguments = parsed as Record<string, unknown>;
  } catch (error) {
    argumentsError.value = error instanceof Error ? error.message : 'Invalid JSON';
    return;
  }

  callPending.value = true;
  result.value = undefined;
  callDurationMs.value = undefined;
  callSizeBytes.value = undefined;
  callStatus.value = undefined;
  activeTab.value = 'structure';
  const startedAt = performance.now();
  try {
    result.value = await workspace.callTool(connectionId, tool.name, parsedArguments);
    callStatus.value = result.value.isError ? 'tool-error' : 'success';
    callSizeBytes.value = new TextEncoder().encode(JSON.stringify(result.value)).length;
  } catch {
    callError.value = 'Unable to call the tool';
    callStatus.value = 'call-failed';
  } finally {
    callDurationMs.value = Math.round(performance.now() - startedAt);
    callPending.value = false;
  }
}

async function copyResult(): Promise<void> {
  if (!result.value) return;
  await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2));
  copied.value = true;
  clearTimeout(copiedTimeout);
  copiedTimeout = setTimeout(() => { copied.value = false; }, 1500);
}
</script>

<template>
  <section class="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
    <RouterLink to="/" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" /> Back to servers
    </RouterLink>
    <h2 class="mt-3 text-2xl font-semibold">{{ profile?.name ?? 'Server' }}</h2>

    <div
      v-if="connection?.state !== 'ready'"
      class="mt-6 border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground"
    >
      Connect this server to see and call its tools.
    </div>
    <div v-else class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <div class="border border-border bg-card">
        <ul>
          <li v-for="tool in tools" :key="tool.name">
            <button
              type="button"
              :data-testid="`tool-${tool.name}`"
              class="w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/60"
              :class="selectedTool?.name === tool.name && 'bg-muted'"
              @click="selectTool(tool)"
            >
              <div class="break-words font-mono text-sm font-medium">{{ tool.name }}</div>
              <div v-if="tool.description" class="mt-1 break-words text-xs text-muted-foreground">{{ tool.description }}</div>
            </button>
          </li>
        </ul>
        <p v-if="tools.length === 0" class="px-4 py-6 text-center text-sm text-muted-foreground">
          This server has no tools.
        </p>
      </div>

      <div v-if="selectedTool" class="min-h-72 border border-border bg-card p-4">
        <h3 class="break-words font-mono text-sm font-medium">{{ selectedTool.name }}</h3>
        <details class="mt-2 text-xs text-muted-foreground">
          <summary class="cursor-pointer">Input schema</summary>
          <pre class="mt-2 overflow-auto">{{ JSON.stringify(selectedTool.inputSchema, null, 2) }}</pre>
        </details>

        <label class="mt-4 block text-xs font-medium uppercase text-muted-foreground" :for="`args-${selectedTool.name}`">
          Arguments (JSON)
        </label>
        <textarea
          :id="`args-${selectedTool.name}`"
          v-model="argumentsText"
          rows="6"
          class="mt-1 w-full border border-border bg-background p-2 font-mono text-xs"
        />
        <p v-if="argumentsError" class="mt-1 text-xs text-destructive">{{ argumentsError }}</p>

        <Button class="mt-3" data-testid="call-tool" :disabled="callPending" @click="callTool">
          {{ callPending ? 'Calling…' : 'Call' }}
        </Button>

        <p v-if="callError" role="alert" class="mt-3 text-sm text-destructive">{{ callError }}</p>

        <div v-if="callStatus" class="mt-4 border-t border-border pt-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              <span class="inline-flex items-center gap-1.5">
                <span class="inline-block size-1.5 rounded-full" :class="STATUS_DOT_CLASS[callStatus]" aria-hidden="true" />
                {{ STATUS_LABEL[callStatus] }}
              </span>
              <span v-if="callDurationMs !== undefined">{{ callDurationMs }} ms</span>
              <span v-if="callSizeBytes !== undefined">{{ formatBytes(callSizeBytes) }}</span>
            </div>
            <Button v-if="result" size="sm" variant="outline" data-testid="copy-result" @click="copyResult">
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
          </div>

          <template v-if="result">
            <div class="flex gap-4 border-b border-border text-xs font-medium">
              <button
                type="button"
                data-testid="tab-structure"
                class="border-b-2 px-1 py-1.5"
                :class="activeTab === 'structure' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'"
                @click="activeTab = 'structure'"
              >
                Structure
              </button>
              <button
                type="button"
                data-testid="tab-raw"
                class="border-b-2 px-1 py-1.5"
                :class="activeTab === 'raw' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'"
                @click="activeTab = 'raw'"
              >
                Raw
              </button>
            </div>

            <div class="mt-3">
              <div v-if="activeTab === 'structure'" data-testid="result-structure">
                <p class="text-xs font-medium uppercase text-muted-foreground">Content</p>
                <p class="mb-2 text-xs text-muted-foreground">Blocks meant for display to a human or LLM.</p>
                <JsonTreeView :data="result.content" />

                <div v-if="result.structuredContent !== undefined" data-testid="structured-content-section" class="mt-4">
                  <p class="text-xs font-medium uppercase text-muted-foreground">Structured Content</p>
                  <p class="mb-2 text-xs text-muted-foreground">Machine-readable data matching the tool's output schema.</p>
                  <JsonTreeView :data="result.structuredContent" />
                </div>
              </div>
              <pre v-else data-testid="result-raw" class="overflow-auto text-xs">{{ JSON.stringify(result, null, 2) }}</pre>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="flex min-h-72 items-center justify-center border border-dashed border-border p-6 text-sm text-muted-foreground">
        Select a tool to call it.
      </div>
    </div>
  </section>
</template>
