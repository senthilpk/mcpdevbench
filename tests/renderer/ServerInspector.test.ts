import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServerInspector from '@/renderer/features/inspector/ServerInspector.vue';
import type { ConnectionSnapshot, ServerProfile } from '@/shared/domain/servers';

const profile: ServerProfile = { id: 'p1', name: 'Fixture Server', transport: 'stdio', command: 'node', args: [] };
const readyConnection: ConnectionSnapshot = {
  connectionId: 'c1',
  profileId: 'p1',
  state: 'ready',
  tools: {
    status: 'ready',
    items: [
      { name: 'echo', description: 'Echo a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } },
    ],
  },
  resources: { status: 'unsupported', items: [] },
  resourceTemplates: { status: 'unsupported', items: [] },
  prompts: { status: 'unsupported', items: [] },
};

async function mountInspector() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] });
  const wrapper = mount(ServerInspector, { props: { profileId: 'p1' }, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('ServerInspector', () => {
  beforeEach(() => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValue([profile]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValue([readyConnection]);
  });

  it('shows a connect-first state when the server is not connected', async () => {
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValue([]);
    const wrapper = await mountInspector();
    expect(wrapper.text()).toContain('Connect this server to see and call its tools.');
  });

  it('lists the discovered tools for a ready connection', async () => {
    const wrapper = await mountInspector();
    expect(wrapper.text()).toContain('echo');
    expect(wrapper.text()).toContain('Echo a message');
  });

  it('shows a JSON parse error inline without calling the tool', async () => {
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{not json');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    expect(window.mcpdevbench.callTool).not.toHaveBeenCalled();
  });

  it('calls the tool with parsed arguments and renders a text result', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'hello back' }] });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{"message":"hi"}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(window.mcpdevbench.callTool).toHaveBeenCalledWith('c1', 'echo', { message: 'hi' });
    expect(wrapper.text()).toContain('hello back');
  });

  it('renders isError results as data, not as an application error', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'bad input' }], isError: true });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('bad input');
    expect(wrapper.text()).toContain('Tool reported an error');
  });

  it('shows a sanitized error banner when the call itself fails', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockRejectedValue(new Error('ECONNRESET raw transport detail'));
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).not.toContain('ECONNRESET');
  });
});
