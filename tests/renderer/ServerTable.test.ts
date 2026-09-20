import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ServerRow } from '@/renderer/features/servers/use-server-workspace';
import ServerTable from '@/renderer/components/domain/ServerTable.vue';
import type { AuthorizationSnapshot } from '@/shared/domain/servers';

const servers: ServerRow[] = [
  { id: 'tveyes', name: 'TVEyes Local', transport: 'STDIO', tools: 12, state: 'connected', connectionId: 'c1' },
  { id: 'search', name: 'Search MCP', transport: 'HTTP', tools: 8, state: 'idle' },
  { id: 'analytics', name: 'Analytics', transport: 'HTTP', tools: 4, state: 'degraded' },
  { id: 'broken', name: 'Broken Fixture', transport: 'STDIO', tools: 0, state: 'error' },
];

describe('ServerTable', () => {
  it('renders semantic headers and every server state', () => {
    const wrapper = mount(ServerTable, { props: { servers } });
    expect(wrapper.get('table').attributes('aria-label')).toBe('Configured servers');
    expect(wrapper.findAll('tbody tr')).toHaveLength(4);
    for (const label of ['Connected', 'Idle', 'Degraded', 'Error']) {
      expect(wrapper.text()).toContain(label);
    }
  });

  it('renders an accessible empty state with an active add command', () => {
    const wrapper = mount(ServerTable, { props: { servers: [] } });
    expect(wrapper.get('[data-testid="empty-servers"]').text()).toContain('No servers configured');
    expect(wrapper.get('button').text()).toContain('Add server');
  });
});

const requiredAuth: AuthorizationSnapshot = { status: 'required', storage: 'persistent', canReopenBrowser: false, canCancel: false };
const waitingAuth: AuthorizationSnapshot = { status: 'waiting', storage: 'persistent', canReopenBrowser: true, canCancel: true };
const completingAuth: AuthorizationSnapshot = { status: 'completing', storage: 'persistent', canReopenBrowser: false, canCancel: false };
const authorizedAuth: AuthorizationSnapshot = {
  status: 'authorized',
  storage: 'session-only',
  canReopenBrowser: false,
  canCancel: false,
  warning: 'Authorization lasts only until MCPDevBench closes.',
};

describe('ServerTable authorization controls', () => {
  const authorizingRow: ServerRow = {
    id: 'oauth', name: 'OAuth Server', transport: 'HTTP', tools: 0, state: 'authorizing',
    connectionId: 'c-oauth', authorization: waitingAuth,
  };
  const connectedOAuthRow: ServerRow = {
    id: 'oauth', name: 'OAuth Server', transport: 'HTTP', tools: 3, state: 'connected',
    connectionId: 'c-oauth', authorization: authorizedAuth,
  };

  it('shows Open browser again and Cancel while waiting', () => {
    const wrapper = mount(ServerTable, { props: { servers: [authorizingRow] } });
    expect(wrapper.get('button[aria-label="Open browser again for OAuth Server"]').isVisible()).toBe(true);
    expect(wrapper.get('button[aria-label="Cancel authorization for OAuth Server"]').isVisible()).toBe(true);
  });

  it('hides Open browser again and Cancel outside the waiting state without changing the button slot count', () => {
    const cases: Array<[ServerRow['state'], AuthorizationSnapshot]> = [
      ['authorization-required', requiredAuth],
      ['authorizing', waitingAuth],
      ['completing-authorization', completingAuth],
    ];
    const slotCounts = cases.map(([state, authorization]) => {
      const wrapper = mount(ServerTable, { props: { servers: [{ ...authorizingRow, state, authorization }] } });
      expect(wrapper.get('button[aria-label="Open browser again for OAuth Server"]').isVisible()).toBe(authorization.canReopenBrowser);
      expect(wrapper.get('button[aria-label="Cancel authorization for OAuth Server"]').isVisible()).toBe(authorization.canCancel);
      return wrapper.findAll('button').length;
    });
    expect(new Set(slotCounts).size).toBe(1);
  });

  it('does not render reopen or cancel controls for non-OAuth rows', () => {
    const wrapper = mount(ServerTable, { props: { servers } });
    expect(wrapper.find('button[aria-label*="Open browser again"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label*="Cancel authorization"]').exists()).toBe(false);
  });

  it('emits reopenAuthorization and cancelAuthorization with the connection id', async () => {
    const wrapper = mount(ServerTable, { props: { servers: [authorizingRow] } });
    await wrapper.get('button[aria-label="Open browser again for OAuth Server"]').trigger('click');
    await wrapper.get('button[aria-label="Cancel authorization for OAuth Server"]').trigger('click');
    expect(wrapper.emitted('reopenAuthorization')).toEqual([['c-oauth']]);
    expect(wrapper.emitted('cancelAuthorization')).toEqual([['c-oauth']]);
  });

  it('shows Sign out only for connected, authorized OAuth profiles', () => {
    const connectedStdio: ServerRow = { id: 'tveyes', name: 'TVEyes Local', transport: 'STDIO', tools: 12, state: 'connected', connectionId: 'c1' };
    const wrapper = mount(ServerTable, { props: { servers: [connectedOAuthRow, connectedStdio] } });
    expect(wrapper.find('button[aria-label="Sign out OAuth Server"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Sign out TVEyes Local"]').exists()).toBe(false);
  });

  it('emits signOut with the profile id after clicking Sign out', async () => {
    const wrapper = mount(ServerTable, { props: { servers: [connectedOAuthRow] } });
    await wrapper.get('button[aria-label="Sign out OAuth Server"]').trigger('click');
    expect(wrapper.emitted('signOut')).toEqual([['oauth']]);
  });

  it('shows the session-only storage warning beneath the connection status', () => {
    const wrapper = mount(ServerTable, { props: { servers: [connectedOAuthRow] } });
    expect(wrapper.text()).toContain('Authorization lasts only until MCPDevBench closes.');
  });
});
