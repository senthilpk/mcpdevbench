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

  it('wraps result text instead of letting it overflow past the panel border', async () => {
    const longWord = 'x'.repeat(200);
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: longWord }] });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    const resultText = wrapper.findAll('span').find((span) => span.text() === `"${longWord}"`);
    expect(resultText?.classes()).toContain('break-words');
  });

  it('gives the placeholder and selected-tool panels the same minimum height', async () => {
    const wrapperBefore = await mountInspector();
    const placeholder = wrapperBefore.get('div.flex.min-h-72');
    expect(placeholder.classes()).toContain('min-h-72');

    const wrapperAfter = await mountInspector();
    await wrapperAfter.get('[data-testid="tool-echo"]').trigger('click');
    const detailPanel = wrapperAfter.findAll('div.border.border-border.bg-card').find((div) => div.find('h3').exists());
    expect(detailPanel?.classes()).toContain('min-h-72');
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
    expect(wrapper.text()).toContain('Tool error');
  });

  it('shows a sanitized error banner when the call itself fails', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockRejectedValue(new Error('ECONNRESET raw transport detail'));
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).not.toContain('ECONNRESET');
    expect(wrapper.text()).toContain('Call failed');
  });

  it('shows duration, size, and a success status after a successful call', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Success');
    expect(wrapper.text()).toMatch(/\d+ ms/);
    expect(wrapper.text()).toMatch(/\d+(\.\d+)? (B|KB)/);
  });

  it('formats a result over 1 MB in size as MB, not thousands of KB', async () => {
    const megabyteOfText = 'x'.repeat(1024 * 1024 + 1);
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: megabyteOfText }] });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toMatch(/\d+(\.\d+)? MB/);
  });

  it('Preview always shows content -- the spec-required field -- with no structuredContent section when absent', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="result-content"]').text()).toContain('"hi"');
    expect(wrapper.find('[data-testid="result-structured-content"]').exists()).toBe(false);
  });

  it('Preview shows content and structuredContent together when the tool returns both', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({
      content: [{ type: 'text', text: 'hi' }],
      structuredContent: { count: 3 },
    });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="result-content"]').text()).toContain('"hi"');
    expect(wrapper.get('[data-testid="result-structured-content"]').text()).toContain('count');
  });

  it('Raw always shows the complete, unfiltered result exactly as the tool returned it', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({
      content: [{ type: 'text', text: 'hi' }],
      structuredContent: { count: 3 },
    });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="tab-raw"]').trigger('click');
    expect(wrapper.find('[data-testid="result-content"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="result-raw"]').text()).toContain('"hi"');
    expect(wrapper.get('[data-testid="result-raw"]').text()).toContain('count');
  });

  it('copies the raw result JSON to the clipboard when Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const wrapper = await mountInspector();
    await wrapper.get('[data-testid="tool-echo"]').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('[data-testid="call-tool"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="copy-result"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }, null, 2));
    expect(wrapper.get('[data-testid="copy-result"]').text()).toBe('Copied');
  });
});
