import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { gantt, handlers, getters, updateDates, access, pluginOrder, scroll, renderBehavior } = vi.hoisted(() => {
    const handlers = {};
    const access = { canEdit: true };
    const pluginOrder = [];
    const scroll = { x: 0, y: 0, inner_width: 140, viewportWidth: 0 };
    const renderBehavior = { resetScroll: false, delayShowDate: false };
    const gantt = {
        config: { drag_mode: { move: 'move', resize: 'resize' } },
        templates: {},
        dragged: {},
        plugins: () => pluginOrder.push('plugins'),
        init() {
            pluginOrder.push('init');
            this.$task = document.createElement('div');
            Object.defineProperty(this.$task, 'clientWidth', { configurable: true, get: () => scroll.viewportWidth });
            this.$root = this.$task;
        },
        render: vi.fn(() => {
            if (renderBehavior.resetScroll) {
                scroll.x = 0;
                scroll.y = 0;
            }
        }),
        parse(data) { this.parsed = data; },
        clearAll: () => {},
        addMarker: () => 'today',
        deleteMarker: () => {},
        detachEvent: () => {},
        attachEvent(name, handler) { handlers[name] = handler; return name; },
        getTask(id) { return this.dragged[id]; },
        getScrollState: () => ({ ...scroll }),
        dateFromPos(position) {
            const date = new Date(this.config.start_date || new Date(2026, 8, 1));
            date.setDate(date.getDate() + Math.floor(position / 10));
            return date;
        },
        posFromDate(value) {
            const start = this.config.start_date || new Date(2026, 8, 1);
            const day = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
            return ((day(value) - day(start)) / 86400000) * 10;
        },
        scrollTo(x, y) { if (x !== undefined && x !== null) scroll.x = x; if (y !== undefined && y !== null) scroll.y = y; },
        showDate(date) {
            if (!renderBehavior.delayShowDate) scroll.x = this.posFromDate(date);
        },
    };
    return { gantt, handlers, getters: {}, updateDates: vi.fn(async () => ({})), access, pluginOrder, scroll, renderBehavior };
});

vi.mock('dhtmlx-gantt', () => ({ gantt }));
vi.mock('dhtmlx-gantt/codebase/dhtmlxgantt.css', () => ({}));
vi.mock('vuex', () => ({ useStore: () => ({ getters }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(async () => ({ data: { status: false } })) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => access.canEdit }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateDates, updateDatesBatch: vi.fn(async () => ({})) } }));
vi.mock('@/views/Projects/helper.js', () => ({ taskListHelper: () => ({ groupBy: () => {} }) }));
vi.mock('@/views/Ai/plainLabels', () => ({ proposalTitle: () => '' }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/composable/useUndoToast', () => ({ showUndoToast: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { render: () => null } }));

import GanttView from '@/views/Projects/GanttView/GanttView.vue';

const PROJECT = 'project-1';
const SPRINT = 'sprint-1';
const day = (number, hour = 0) => new Date(2026, 8, number, hour);
const makeTask = (id, startDate, DueDate, extra = {}) => ({
    _id: id, TaskName: id, ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, startDate, DueDate, relations: [], ...extra,
});

const open = async ({ tasks, canEdit = true, delayShowDate = false } = {}) => {
    access.canEdit = canEdit;
    getters['settings/selectedCompany'] = { _id: 'company-1' };
    getters['users/users'] = [];
    getters['projectData/tableTasks'] = {};
    getters['projectData/tasks'] = { [PROJECT]: { [SPRINT]: { tasks: tasks || [makeTask('task-1', day(4, 9), day(6, 17))] } } };
    gantt.dragged = {};
    gantt.parsed = null;
    gantt.config = { drag_mode: { move: 'move', resize: 'resize' } };
    gantt.$task = null;
    gantt.$root = null;
    renderBehavior.resetScroll = false;
    renderBehavior.delayShowDate = delayShowDate;
    scroll.x = 0;
    scroll.y = 0;
    scroll.inner_width = 140;
    scroll.viewportWidth = 0;
    pluginOrder.length = 0;
    Object.keys(handlers).forEach((key) => delete handlers[key]);
    const wrapper = mount(GanttView, {
        props: { projectData: { _id: PROJECT, isGlobalPermission: true }, sprints: [{ id: SPRINT, name: 'Sprint' }] },
        global: { stubs: { 'router-link': true } },
    });
    await flushPromises();
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    updateDates.mockReset();
    updateDates.mockResolvedValue({});
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
});

afterEach(() => vi.unstubAllGlobals());

describe('Gantt timeline integration', () => {
    it('activates drag-to-pan before init and keeps a managed date range', async () => {
        const wrapper = await open();

        expect(pluginOrder).toEqual(['plugins', 'init']);
        expect(gantt.config.fit_tasks).toBe(false);
        expect(gantt.config.drag_timeline).toEqual({ ignore: '.gantt_task_line, .gantt_task_link', useKey: false });
        expect(gantt.config.start_date).toBeInstanceOf(Date);
        expect(gantt.config.end_date).toBeInstanceOf(Date);
        expect(gantt.dateFromPos(scroll.x)).toEqual(day(4, 9));
        wrapper.unmount();
    });

    it('waits for task or milestone dates before creating the initial managed range', async () => {
        const wrapper = await open({ tasks: [] });

        expect(gantt.config.start_date).toBeUndefined();
        expect(gantt.config.end_date).toBeUndefined();
        wrapper.unmount();
    });

    it('keeps the earliest task date as the initial anchor across a render before deferred viewport restore', async () => {
        const frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback) => { frames.push(callback); return frames.length; });
        const wrapper = await open({ delayShowDate: true });
        const firstDate = new Date(getters['projectData/tasks'][PROJECT][SPRINT].tasks[0].startDate);

        expect(scroll.x).toBe(0);
        wrapper.vm.$.setupState.renderData();
        while (frames.length) frames.shift()();

        expect(gantt.dateFromPos(scroll.x).toDateString()).toBe(firstDate.toDateString());
        wrapper.unmount();
    });

    it('extends the timeline left and right on scroll without changing any task dates', async () => {
        const original = { ...getters['projectData/tasks'][PROJECT][SPRINT].tasks[0] };
        const wrapper = await open();
        scroll.x = 0;
        const initialStart = new Date(gantt.config.start_date);
        const initialEnd = new Date(gantt.config.end_date);
        const leftAnchor = gantt.dateFromPos(scroll.x).getTime();
        scroll.y = 45;

        handlers.onGanttScroll(0, 0);
        const extendedStart = new Date(gantt.config.start_date);
        expect(extendedStart.getTime()).toBeLessThan(initialStart.getTime());
        expect(gantt.dateFromPos(scroll.x).getTime()).toBe(leftAnchor);
        expect(scroll.y).toBe(45);
        handlers.onGanttScroll(scroll.x, scroll.y);
        expect(gantt.config.start_date.getTime()).toBe(extendedStart.getTime());

        const nearRight = new Date(gantt.config.end_date);
        const nearRightStart = new Date(nearRight);
        nearRightStart.setDate(nearRightStart.getDate() - 7);
        scroll.x = gantt.posFromDate(nearRightStart);
        const rightAnchor = gantt.dateFromPos(scroll.x).getTime();
        handlers.onGanttScroll(scroll.x, scroll.y);
        expect(gantt.config.end_date.getTime()).toBeGreaterThan(initialEnd.getTime());
        expect(gantt.dateFromPos(scroll.x).getTime()).toBe(rightAnchor);
        expect(getters['projectData/tasks'][PROJECT][SPRINT].tasks[0]).toMatchObject(original);
        expect(updateDates).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('uses the rendered viewport width when DHTMLX reports an invalid inner width', async () => {
        scroll.viewportWidth = 70;
        scroll.inner_width = 1;
        const wrapper = await open();
        const initialStart = new Date(gantt.config.start_date);
        scroll.x = 0;

        handlers.onGanttScroll(scroll.x, scroll.y);

        expect(initialStart.getTime() - gantt.config.start_date.getTime()).toBeGreaterThanOrEqual(7 * 86400000);
        wrapper.unmount();
    });

    it('keeps the pan anchor and row when a left-edge expansion rerenders during the gesture', async () => {
        const wrapper = await open();
        const initialStart = new Date(gantt.config.start_date);
        scroll.x = 0;
        scroll.y = 38;
        const anchor = gantt.dateFromPos(scroll.x);
        renderBehavior.resetScroll = true;
        gantt.$task.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

        handlers.onGanttScroll(scroll.x, scroll.y);

        expect(gantt.config.start_date.getTime()).toBeLessThan(initialStart.getTime());
        expect(gantt.dateFromPos(scroll.x)).toEqual(anchor);
        expect(scroll.y).toBe(38);

        const continuedPanDate = new Date(anchor);
        continuedPanDate.setDate(continuedPanDate.getDate() - 2);
        scroll.x = gantt.posFromDate(continuedPanDate);
        scroll.y = 51;
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        expect(gantt.dateFromPos(scroll.x)).toEqual(continuedPanDate);
        expect(scroll.y).toBe(51);
        wrapper.unmount();
    });

    it('keeps the viewport anchor when task-drag growth rerenders the timeline', async () => {
        const wrapper = await open();
        scroll.x = gantt.posFromDate(day(5));
        scroll.y = 63;
        const anchor = gantt.dateFromPos(scroll.x);
        renderBehavior.resetScroll = true;
        const target = { start_date: day(30), end_date: day(32) };
        handlers.onBeforeTaskDrag('task-1');

        handlers.onTaskDrag('task-1', 'move', target);

        expect(gantt.dateFromPos(scroll.x)).toEqual(anchor);
        expect(scroll.y).toBe(63);
        wrapper.unmount();
    });

    it('moves a bar by calendar days while preserving both endpoint times', async () => {
        const wrapper = await open();
        handlers.onBeforeTaskDrag('task-1');
        gantt.dragged['task-1'] = { start_date: day(5, 9), end_date: day(7, 17) };
        handlers.onAfterTaskDrag('task-1', 'move');

        expect(updateDates).toHaveBeenCalledWith(expect.objectContaining({
            firebaseObj: { startDate: day(5, 9), DueDate: day(7, 17) },
        }));
        wrapper.unmount();
    });

    it('abandons a drag when the task dates changed in the store during the gesture', async () => {
        const wrapper = await open();
        const task = getters['projectData/tasks'][PROJECT][SPRINT].tasks[0];
        handlers.onBeforeTaskDrag('task-1');
        task.DueDate = day(8, 17);
        gantt.dragged['task-1'] = { start_date: day(5, 9), end_date: day(7, 17) };
        handlers.onAfterTaskDrag('task-1', 'move');

        expect(updateDates).not.toHaveBeenCalled();
        expect(gantt.parsed.data.find((item) => item.id === 'task-1').end_date).toEqual(day(8, 17));
        wrapper.unmount();
    });

    it('resizes only the edge the user dragged', async () => {
        const wrapper = await open();
        handlers.onBeforeTaskDrag('task-1');
        gantt.dragged['task-1'] = { start_date: day(3, 9), end_date: day(6, 17) };
        handlers.onAfterTaskDrag('task-1', 'resize');

        expect(updateDates).toHaveBeenCalledWith(expect.objectContaining({
            firebaseObj: { startDate: day(3, 9), DueDate: day(6, 17) },
        }));
        wrapper.unmount();
    });

    it('resizes the right edge without changing the stored start endpoint', async () => {
        const wrapper = await open();
        handlers.onBeforeTaskDrag('task-1');
        gantt.dragged['task-1'] = { start_date: day(4, 9), end_date: day(8, 17) };
        handlers.onAfterTaskDrag('task-1', 'resize');

        expect(updateDates).toHaveBeenCalledWith(expect.objectContaining({
            firebaseObj: { startDate: day(4, 9), DueDate: day(8, 17) },
        }));
        wrapper.unmount();
    });

    it('extends managed bounds during a task drag before saving and blocks archived or unauthorized drags', async () => {
        const wrapper = await open();
        const target = { start_date: day(20), end_date: day(22) };
        const beforeEnd = new Date(gantt.config.end_date);
        handlers.onBeforeTaskDrag('task-1');
        handlers.onTaskDrag('task-1', 'move', target);
        expect(gantt.config.end_date.getTime()).toBeGreaterThanOrEqual(target.end_date.getTime());
        expect(gantt.config.end_date.getTime()).toBeGreaterThan(beforeEnd.getTime());
        expect(updateDates).not.toHaveBeenCalled();
        wrapper.unmount();

        const archived = await open({ tasks: [makeTask('archived', day(4), day(6), { deletedStatusKey: 2 })] });
        expect(gantt.parsed.data.find((item) => item.id === 'archived').readonly).toBe(true);
        expect(handlers.onBeforeTaskDrag('archived')).toBe(false);
        archived.unmount();

        const readOnly = await open({ canEdit: false });
        expect(handlers.onBeforeTaskDrag('task-1')).toBe(false);
        readOnly.unmount();
    });

    it('does not offer or perform scheduling for archived unscheduled tasks', async () => {
        const wrapper = await open({
            tasks: [makeTask('archived-unscheduled', null, null, { deletedStatusKey: 2 })],
        });

        expect(wrapper.get('.gv__tray').exists()).toBe(true);
        expect(wrapper.get('.gv__tray-item').text()).toContain('archived-unscheduled');
        expect(wrapper.find('.gv__tray-item button').exists()).toBe(false);
        wrapper.vm.$.setupState.schedule(getters['projectData/tasks'][PROJECT][SPRINT].tasks[0]);
        expect(updateDates).not.toHaveBeenCalled();

        wrapper.unmount();
    });
});
