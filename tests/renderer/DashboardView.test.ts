import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

describe('DashboardView', () => {
  it('renders live empty metrics without demonstration servers', async () => {
    const wrapper = mount(DashboardView);
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('Servers');
    expect(wrapper.text()).toContain('0 configured');
    expect(wrapper.text()).not.toContain('TVEyes Local');
  });

  it('exposes Add server as an active command', async () => {
    const wrapper = mount(DashboardView);
    await flushPromises();
    expect(wrapper.get('button').text()).toContain('Add server');
    expect(wrapper.find('button[disabled]').exists()).toBe(false);
  });
});
