import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GanttTaskMenu from '@/views/Projects/GanttView/GanttTaskMenu.vue';

const mountMenu = (props = {}) => mount(GanttTaskMenu, {
    props: { x: 40, y: 60, canUnschedule: true, ...props },
    attachTo: document.body,
    global: { mocks: { $t: (key) => key } }
});

const itemsOf = (wrapper) => wrapper.findAll('[role="menuitem"]');

let wrapper = null;
afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('GanttTaskMenu', () => {
    it('renders the open and unschedule items with their i18n keys', () => {
        wrapper = mountMenu();
        const items = itemsOf(wrapper);
        expect(items).toHaveLength(2);
        expect(items[0].text()).toBe('Views.open_task');
        expect(items[1].text()).toBe('Views.unschedule');
        expect(wrapper.attributes('role')).toBe('menu');
        expect(wrapper.attributes('style')).toContain('left: 40px');
        expect(wrapper.attributes('style')).toContain('top: 60px');
    });

    it('emits open and unschedule on click', async () => {
        wrapper = mountMenu();
        const items = itemsOf(wrapper);
        await items[0].trigger('click');
        await items[1].trigger('click');
        expect(wrapper.emitted('open')).toHaveLength(1);
        expect(wrapper.emitted('unschedule')).toHaveLength(1);
    });

    it('disables unschedule when it cannot be removed and emits nothing on click', async () => {
        wrapper = mountMenu({ canUnschedule: false });
        const unschedule = itemsOf(wrapper)[1];
        expect(unschedule.attributes('disabled')).toBeDefined();
        expect(unschedule.attributes('aria-disabled')).toBe('true');
        await unschedule.trigger('click');
        expect(wrapper.emitted('unschedule')).toBeUndefined();
    });

    it('uses the lock reason as the title when unscheduling is blocked', () => {
        wrapper = mountMenu({ canUnschedule: false, lockedReason: 'Has dependents' });
        expect(itemsOf(wrapper)[1].attributes('title')).toBe('Has dependents');
    });

    it('falls back to the locked i18n title when no reason is given', () => {
        wrapper = mountMenu({ canUnschedule: false });
        expect(itemsOf(wrapper)[1].attributes('title')).toBe('Views.unschedule_locked');
    });

    it('focuses the first item on mount', async () => {
        wrapper = mountMenu();
        await nextTick();
        expect(document.activeElement).toBe(itemsOf(wrapper)[0].element);
    });

    it('emits close on Escape', async () => {
        wrapper = mountMenu();
        await wrapper.trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('moves focus with the arrow keys over enabled items only', async () => {
        wrapper = mountMenu();
        await nextTick();
        const items = itemsOf(wrapper);
        await wrapper.trigger('keydown', { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1].element);
        await wrapper.trigger('keydown', { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[0].element);
        await wrapper.trigger('keydown', { key: 'ArrowUp' });
        expect(document.activeElement).toBe(items[1].element);
    });

    it('keeps focus on the only enabled item when arrows are pressed', async () => {
        wrapper = mountMenu({ canUnschedule: false });
        await nextTick();
        const items = itemsOf(wrapper);
        await wrapper.trigger('keydown', { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[0].element);
    });

    it('emits close for a pointerdown outside the menu but not inside it', async () => {
        wrapper = mountMenu();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(wrapper.emitted('close')).toHaveLength(1);

        itemsOf(wrapper)[0].element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('prevents the native context menu on the menu', async () => {
        wrapper = mountMenu();
        const event = new Event('contextmenu', { bubbles: true, cancelable: true });
        wrapper.element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('removes the outside-pointerdown listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        wrapper = mountMenu();
        wrapper.unmount();
        wrapper = null;
        expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
        removeSpy.mockRestore();
    });
});
