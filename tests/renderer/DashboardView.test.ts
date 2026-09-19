import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

describe('DashboardView', () => {
  it('renders metrics and demonstration servers', () => {
    const wrapper = mount(DashboardView);
    expect(wrapper.get('h2').text()).toBe('Servers');
    expect(wrapper.text()).toContain('24');
    expect(wrapper.text()).toContain('TVEyes Local');
  });

  it('marks Add server unavailable instead of exposing a dead action', () => {
    const wrapper = mount(DashboardView);
    const button = wrapper.get('button[disabled]');
    expect(button.attributes('aria-describedby')).toBe('add-server-unavailable');
    expect(wrapper.get('#add-server-unavailable').text()).toContain('available with connection setup');
  });
});
