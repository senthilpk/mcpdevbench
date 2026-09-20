import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ApplicationStatus from '@/renderer/components/domain/ApplicationStatus.vue';
import ConnectionStatus from '@/renderer/components/domain/ConnectionStatus.vue';

describe('ApplicationStatus', () => {
  it.each([
    ['starting', 'Starting'],
    ['ready', 'Ready'],
    ['unavailable', 'Unavailable'],
  ] as const)('labels the %s state', (state, label) => {
    const wrapper = mount(ApplicationStatus, { props: { state } });
    expect(wrapper.get('[role="status"]').text()).toContain(label);
  });
});

describe('ConnectionStatus', () => {
  it.each([
    ['connected', 'Connected'],
    ['idle', 'Idle'],
    ['degraded', 'Degraded'],
    ['error', 'Error'],
    ['authorization-required', 'Authorization required'],
    ['authorizing', 'Waiting for browser'],
    ['completing-authorization', 'Completing authorization'],
  ] as const)('communicates %s with text', (state, label) => {
    const wrapper = mount(ConnectionStatus, { props: { state } });
    expect(wrapper.text()).toContain(label);
  });
});
