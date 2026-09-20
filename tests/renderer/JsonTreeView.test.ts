import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import JsonTreeView from '@/renderer/components/domain/JsonTreeView.vue';

describe('JsonTreeView', () => {
  it('renders a string primitive inline, quoted', () => {
    const wrapper = mount(JsonTreeView, { props: { data: 'hello' } });
    expect(wrapper.text()).toBe('"hello"');
  });

  it('renders number, boolean, and null primitives without quotes', () => {
    expect(mount(JsonTreeView, { props: { data: 42 } }).text()).toBe('42');
    expect(mount(JsonTreeView, { props: { data: true } }).text()).toBe('true');
    expect(mount(JsonTreeView, { props: { data: null } }).text()).toBe('null');
  });

  it('renders an object as an expandable node with its entry count', () => {
    const wrapper = mount(JsonTreeView, { props: { data: { a: 1, b: 2 } } });
    expect(wrapper.text()).toContain('Object(2)');
  });

  it('renders an array as an expandable node with its item count', () => {
    const wrapper = mount(JsonTreeView, { props: { data: [1, 2, 3] } });
    expect(wrapper.text()).toContain('Array(3)');
  });

  it('expands top-level nodes by default and shows their children', () => {
    const wrapper = mount(JsonTreeView, { props: { data: { message: 'hi' } } });
    expect(wrapper.text()).toContain('message');
    expect(wrapper.text()).toContain('"hi"');
  });

  it('collapses deeply nested nodes by default', () => {
    const wrapper = mount(JsonTreeView, { props: { data: { a: { b: { deep: 'value' } } } } });
    expect(wrapper.text()).not.toContain('deep');
  });

  it('toggles a node open and closed on click', async () => {
    const wrapper = mount(JsonTreeView, { props: { data: { a: { b: { deep: 'value' } } } } });
    // root(depth 0, expanded) -> "a"'s value container (depth 1, expanded) -> "b"'s value
    // container (depth 2, collapsed by default) -- its toggle is the last button rendered.
    const toggles = wrapper.findAll('button');
    const bToggle = toggles.at(-1);
    expect(wrapper.text()).not.toContain('deep');
    await bToggle?.trigger('click');
    expect(wrapper.text()).toContain('deep');
    await bToggle?.trigger('click');
    expect(wrapper.text()).not.toContain('deep');
  });
});
