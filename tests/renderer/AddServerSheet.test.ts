import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AddServerSheet from '@/renderer/features/servers/AddServerSheet.vue';

const mountSheet = () => mount(AddServerSheet, {
  props: { open: true },
  global: { stubs: { teleport: { template: '<div><slot /></div>' } } },
});

describe('AddServerSheet', () => {
  it('switches transport fields without retaining hidden values', async () => {
    const wrapper = mountSheet();
    await wrapper.get('[name="command"]').setValue('node');
    await wrapper.get('[name="transport"]').setValue('streamable-http');
    expect(wrapper.find('[name="command"]').exists()).toBe(false);
    expect(wrapper.get('[name="url"]').element.tagName).toBe('INPUT');
  });

  it('emits a normalized STDIO profile with one argument per line', async () => {
    const wrapper = mountSheet();
    await wrapper.get('[name="name"]').setValue('Fixture');
    await wrapper.get('[name="command"]').setValue('node');
    await wrapper.get('[name="args"]').setValue('server.mjs\n--quiet\n');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')?.[0]).toEqual([{
      name: 'Fixture', transport: 'stdio', command: 'node', args: ['server.mjs', '--quiet'],
    }]);
  });

  it('keeps save disabled for relative HTTP URLs', async () => {
    const wrapper = mountSheet();
    await wrapper.get('[name="transport"]').setValue('streamable-http');
    await wrapper.get('[name="name"]').setValue('Remote');
    await wrapper.get('[name="url"]').setValue('/mcp');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  });
});
