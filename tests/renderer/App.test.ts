import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import App from '@/renderer/app/App.vue';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

describe('App', () => {
  it('shows the product identity and ready status', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: DashboardView }],
    });
    const wrapper = mount(App, { global: { plugins: [router] } });

    await router.isReady();
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('MCPDevBench');
    expect(wrapper.get('[data-testid="app-status"]').text()).toBe('Ready');
  });
});
