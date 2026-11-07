import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { config, flushPromises, mount } from '@vue/test-utils';
import en from '@/locales/en.js';
import { formatDisplayDate } from '@/views/Settings/Language/localePrefs';

const { gantt, handlers, getters, updateDates, access, pluginOrder, scroll, renderBehavior, toast } = vi.hoisted(() => {
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
    const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    return { gantt, handlers, getters: {}, updateDates: vi.fn(async () => ({})), access, pluginOrder, scroll, renderBehavior, toast };
});

vi.mock('dhtmlx-gantt', () => ({ gantt }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
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
import GanttTaskMenu from '@/views/Projects/GanttView/GanttTaskMenu.vue';
import { showUndoToast } from '@/composable/useUndoToast';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const ZOOM_KEY = `gantt.zoom.v1.${PROJECT}`;
const offsetDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const wheel = (deltaY, init = {}) => new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true, ...init });
const ctrlWheel = (deltaY, init = {}) => wheel(deltaY, { ctrlKey: true, ...init });
const clock = { now: 1000 };
let queued = new Map();
let frameId = 1;
let cancelFrame = null;
let perfSpy = null;

const i18n = config.global.plugins.find((plugin) => plugin?.global?.mergeLocaleMessage);
i18n.global.mergeLocaleMessage('en', {
    Views: {
        zoom_days: en.Views.zoom_days,
        zoom_weeks: en.Views.zoom_weeks,
        zoom_months: en.Views.zoom_months,
        drag_range: en.Views.drag_range,
    },
});

const queueFrames = () => {
    queued = new Map();
    frameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback) => {
        const id = frameId;
        frameId += 1;
        queued.set(id, callback);
        return id;
    });
    cancelFrame = vi.fn((id) => { queued.delete(id); });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
};
const runNextFrame = () => {
    const [id, callback] = queued.entries().next().value;
    queued.delete(id);
    callback();
};
const settle = () => { while (queued.size) runNextFrame(); };
const openSettled = async (options) => {
    const wrapper = await open(options);
    settle();
    return wrapper;
};
const width = () => gantt.config.min_column_width;
const activeTab = (wrapper) => wrapper.get('.gv__zoom .ah-tab.is-on').text();

beforeEach(() => {
    updateDates.mockReset();
    updateDates.mockResolvedValue({});
    localStorage.clear();
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

    describe('ctrl+wheel zoom, persistence and drag feedback', () => {
        beforeEach(() => {
            queueFrames();
            clock.now = 1000;
            perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
        });

        afterEach(() => {
            perfSpy.mockRestore();
            vi.useRealTimers();
        });

        it('zooms once per animation frame on ctrl+wheel over the timeline and ignores a plain wheel', async () => {
            const wrapper = await openSettled();
            const root = gantt.$root;
            expect(width()).toBe(70);
            gantt.render.mockClear();

            const plain = wheel(-100);
            root.dispatchEvent(plain);
            expect(plain.defaultPrevented).toBe(false);
            expect(queued.size).toBe(0);
            expect(gantt.render).not.toHaveBeenCalled();
            expect(width()).toBe(70);

            const zoom = ctrlWheel(-100, { clientX: 0 });
            root.dispatchEvent(zoom);
            expect(zoom.defaultPrevented).toBe(true);
            expect(gantt.render).not.toHaveBeenCalled();
            runNextFrame();
            expect(gantt.render).toHaveBeenCalledTimes(1);
            expect(width()).toBe(82);
            wrapper.unmount();
        });

        it('coalesces ten ctrl+wheel events in one frame into a single render and defers a frame inside 33ms', async () => {
            const wrapper = await openSettled();
            const root = gantt.$root;
            gantt.render.mockClear();

            for (let i = 0; i < 10; i += 1) root.dispatchEvent(ctrlWheel(-5));
            expect(queued.size).toBe(1);
            runNextFrame();
            expect(gantt.render).toHaveBeenCalledTimes(1);
            expect(width()).toBe(115);

            settle();
            gantt.render.mockClear();
            clock.now = 1010;
            root.dispatchEvent(ctrlWheel(-5));
            runNextFrame();
            expect(gantt.render).not.toHaveBeenCalled();
            expect(queued.size).toBe(1);
            expect(width()).toBe(115);

            clock.now = 1040;
            runNextFrame();
            expect(gantt.render).toHaveBeenCalledTimes(1);
            expect(width()).toBe(121);
            wrapper.unmount();
        });

        it('leaves zoom untouched while a task drag or a timeline pan is in progress', async () => {
            const dragging = await openSettled();
            gantt.dragged['task-1'] = { start_date: day(4, 9), end_date: day(6, 17) };
            expect(handlers.onBeforeTaskDrag('task-1')).toBe(true);
            gantt.render.mockClear();

            gantt.$root.dispatchEvent(ctrlWheel(-100));
            expect(queued.size).toBe(0);
            expect(gantt.render).not.toHaveBeenCalled();
            expect(width()).toBe(70);
            dragging.unmount();

            const panning = await openSettled();
            gantt.$root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            gantt.render.mockClear();

            gantt.$root.dispatchEvent(ctrlWheel(-100));
            expect(queued.size).toBe(0);
            expect(gantt.render).not.toHaveBeenCalled();
            expect(width()).toBe(70);
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
            panning.unmount();
        });

        it('keeps the date under the cursor at the same pixel while zooming', async () => {
            const wrapper = await openSettled();
            const root = gantt.$root;
            const rectLeft = 40;
            const clientX = 140;
            const offsetX = clientX - rectLeft;
            vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: rectLeft, top: 0, width: 800, height: 400 });
            scroll.x = 300;
            const dateSpy = vi.spyOn(gantt, 'dateFromPos');
            const scrollSpy = vi.spyOn(gantt, 'scrollTo');

            root.dispatchEvent(ctrlWheel(-100, { clientX }));
            runNextFrame();

            const index = dateSpy.mock.calls.findIndex(([position]) => position === 300 + offsetX);
            expect(index).toBeGreaterThanOrEqual(0);
            const anchorDate = dateSpy.mock.results[index].value;
            expect(scrollSpy.mock.calls.at(-1)[0]).toBe(gantt.posFromDate(anchorDate) - offsetX);
            wrapper.unmount();
        });

        it('saves the zoom 250ms after the last change', async () => {
            const wrapper = await openSettled();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            gantt.$root.dispatchEvent(ctrlWheel(-100));
            runNextFrame();

            expect(localStorage.getItem(ZOOM_KEY)).toBeNull();
            vi.advanceTimersByTime(249);
            expect(localStorage.getItem(ZOOM_KEY)).toBeNull();
            vi.advanceTimersByTime(1);
            expect(Number(localStorage.getItem(ZOOM_KEY))).toBeCloseTo(10 * Math.exp(0.16), 6);
            wrapper.unmount();
        });

        it('saves a zoom that is still pending when the timeline unmounts', async () => {
            const wrapper = await openSettled();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            gantt.$root.dispatchEvent(ctrlWheel(-100));
            runNextFrame();
            expect(localStorage.getItem(ZOOM_KEY)).toBeNull();

            wrapper.unmount();
            expect(Number(localStorage.getItem(ZOOM_KEY))).toBeCloseTo(10 * Math.exp(0.16), 6);
        });

        it('restores the saved band on the next mount and falls back to Week for unreadable values', async () => {
            localStorage.setItem(ZOOM_KEY, '30');
            let wrapper = await openSettled();
            expect(activeTab(wrapper)).toBe('Days');
            wrapper.unmount();

            localStorage.setItem(ZOOM_KEY, '2');
            wrapper = await openSettled();
            expect(activeTab(wrapper)).toBe('Months');
            wrapper.unmount();

            for (const unreadable of ['abc', 'NaN', '']) {
                localStorage.setItem(ZOOM_KEY, unreadable);
                wrapper = await openSettled();
                expect(activeTab(wrapper)).toBe('Weeks');
                expect(width()).toBe(70);
                wrapper.unmount();
            }
        });

        it('switches the zoom band from the Day, Week and Month tabs and marks the active tab', async () => {
            const wrapper = await openSettled();
            const tab = (label) => wrapper.findAll('.gv__zoom .ah-tab').find((button) => button.text() === label);
            expect(activeTab(wrapper)).toBe('Weeks');

            await tab('Days').trigger('click');
            expect(activeTab(wrapper)).toBe('Days');
            expect(gantt.config.scales.at(-1).unit).toBe('hour');

            await tab('Months').trigger('click');
            expect(activeTab(wrapper)).toBe('Months');
            expect(gantt.config.scales.at(-1).unit).toBe('week');

            await tab('Weeks').trigger('click');
            expect(activeTab(wrapper)).toBe('Weeks');
            expect(width()).toBe(70);
            wrapper.unmount();
        });

        it('snaps a moving bar to whole days in onTaskDrag and onBeforeTaskChanged', async () => {
            const wrapper = await openSettled();
            gantt.dragged['task-1'] = { start_date: day(4, 9), end_date: day(6, 17) };
            expect(handlers.onBeforeTaskDrag('task-1')).toBe(true);
            const original = { start_date: day(4, 9), end_date: day(6, 17) };

            const forward = { start_date: offsetDays(day(4, 9), 0.6), end_date: offsetDays(day(6, 17), 0.6) };
            handlers.onTaskDrag('task-1', 'move', forward, original, undefined);
            expect(forward.start_date).toEqual(day(5, 9));
            expect(forward.end_date).toEqual(day(7, 17));

            const short = { start_date: offsetDays(day(4, 9), 0.4), end_date: offsetDays(day(6, 17), 0.4) };
            handlers.onTaskDrag('task-1', 'move', short, original, undefined);
            expect(short.start_date).toEqual(day(4, 9));
            expect(short.end_date).toEqual(day(6, 17));

            gantt.dragged['task-1'] = { start_date: offsetDays(day(4, 9), 0.6), end_date: offsetDays(day(6, 17), 0.6) };
            expect(handlers.onBeforeTaskChanged('task-1', 'move')).toBe(true);
            expect(gantt.dragged['task-1'].start_date).toEqual(day(5, 9));
            expect(gantt.dragged['task-1'].end_date).toEqual(day(7, 17));
            wrapper.unmount();
        });

        it('shows the drag range beside the pointer and clears it on drop, blur and unmount', async () => {
            const showDragTip = () => {
                gantt.dragged['task-1'] = { start_date: day(4, 9), end_date: day(6, 17) };
                handlers.onBeforeTaskDrag('task-1');
                handlers.onTaskDrag(
                    'task-1',
                    'move',
                    { start_date: offsetDays(day(4, 9), 1), end_date: offsetDays(day(6, 17), 1) },
                    { start_date: day(4, 9), end_date: day(6, 17) },
                    { clientX: 300, clientY: 200 },
                );
            };

            const wrapper = await openSettled();
            vi.spyOn(wrapper.get('.gv__main').element, 'getBoundingClientRect').mockReturnValue({
                left: 100, top: 100, width: 800, height: 400,
            });

            showDragTip();
            await nextTick();
            const expectedText = i18n.global.t('Views.drag_range', {
                start: formatDisplayDate(day(5, 9), 'MMM D'),
                end: formatDisplayDate(day(7, 17), 'MMM D'),
            });
            expect(expectedText).toContain('→');
            const tip = wrapper.get('.gv__dragtip');
            expect(tip.text()).toBe(expectedText);
            expect(tip.attributes('style')).toContain('left: 212px');
            expect(tip.attributes('style')).toContain('top: 70px');

            handlers.onAfterTaskDrag('task-1', 'move');
            await nextTick();
            expect(wrapper.find('.gv__dragtip').exists()).toBe(false);

            showDragTip();
            await nextTick();
            expect(wrapper.find('.gv__dragtip').exists()).toBe(true);
            window.dispatchEvent(new Event('blur'));
            await nextTick();
            expect(wrapper.find('.gv__dragtip').exists()).toBe(false);

            showDragTip();
            const setup = wrapper.vm.$.setupState;
            expect(setup.dragTip).not.toBeNull();
            wrapper.unmount();
            expect(setup.dragTip).toBeNull();
        });

        it('ignores ctrl+wheel on the old timeline root after unmount and cancels its pending zoom frame', async () => {
            const wrapper = await openSettled();
            const root = gantt.$root;
            const before = width();
            gantt.render.mockClear();

            root.dispatchEvent(ctrlWheel(-100));
            expect(queued.size).toBe(1);
            wrapper.unmount();
            expect(cancelFrame).toHaveBeenCalled();
            expect(queued.size).toBe(0);

            const late = ctrlWheel(-100);
            root.dispatchEvent(late);
            expect(late.defaultPrevented).toBe(false);
            settle();
            expect(gantt.render).not.toHaveBeenCalled();
            expect(width()).toBe(before);
        });
    });
});

describe('task menu, unschedule and tray drop', () => {
    const spanKeyOf = (taskId) => `gantt.span.v1.${PROJECT}.${taskId}`;
    const contextMenuAt = (taskId = 'task-1') => {
        const event = { clientX: 150, clientY: 130, preventDefault: vi.fn() };
        const result = handlers.onContextMenu(taskId, null, event);
        return { result, event };
    };
    const removeItem = (wrapper) => wrapper.findAll('.gv__menu-item')[1];
    const scheduledTask = (extra) => makeTask('task-1', day(4, 9), day(6, 17), extra);
    const trayTask = (extra) => makeTask('tray-1', null, null, extra);
    const dataTransferStub = () => ({
        types: ['application/x-alianhub-task'],
        data: {},
        setData(key, value) { this.data[key] = value; },
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
    });
    const dragEvent = (type, dataTransfer, init = {}) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        return event;
    };
    let dateSpy = null;
    const pinDropDate = (value) => {
        dateSpy = vi.spyOn(gantt, 'dateFromPos').mockReturnValue(value);
        return dateSpy;
    };
    const dragTrayTo = (wrapper, clientX = 120) => {
        const dataTransfer = dataTransferStub();
        wrapper.get('.gv__tray-item').element.dispatchEvent(dragEvent('dragstart', dataTransfer));
        gantt.$task.dispatchEvent(dragEvent('dragover', dataTransfer, { clientX }));
        gantt.$task.dispatchEvent(dragEvent('drop', dataTransfer, { clientX }));
    };

    beforeEach(() => {
        queueFrames();
        clock.now = 1000;
        perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
        showUndoToast.mockClear();
        toast.error.mockClear();
    });

    afterEach(() => {
        dateSpy?.mockRestore();
        dateSpy = null;
        perfSpy.mockRestore();
    });

    it('opens the task menu on right-click of a scheduled task with Remove enabled', async () => {
        const wrapper = await openSettled();
        const rect = vi.spyOn(wrapper.get('.gv__main').element, 'getBoundingClientRect')
            .mockReturnValue({ left: 100, top: 100, width: 800, height: 400 });

        const { result, event } = contextMenuAt('task-1');
        await nextTick();

        expect(result).toBe(false);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        const menu = wrapper.findComponent(GanttTaskMenu);
        expect(menu.exists()).toBe(true);
        expect(menu.props('canUnschedule')).toBe(true);
        expect(menu.props('x')).toBe(50);
        expect(menu.props('y')).toBe(30);
        rect.mockRestore();
        wrapper.unmount();
    });

    it('leaves span, milestone and unknown ids to the native context menu', async () => {
        const wrapper = await openSettled();

        for (const id of ['sp_x', 'ms_x', 'unknown']) {
            const { result, event } = contextMenuAt(id);
            expect(result).toBe(true);
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
        await nextTick();
        expect(wrapper.find('.gv__menu').exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders Remove disabled for read-only and archived tasks', async () => {
        let wrapper = await openSettled({ canEdit: false });
        contextMenuAt('task-1');
        await nextTick();
        expect(wrapper.findComponent(GanttTaskMenu).props('canUnschedule')).toBe(false);
        expect(removeItem(wrapper).attributes('disabled')).toBeDefined();
        wrapper.unmount();

        wrapper = await openSettled({ tasks: [scheduledTask({ deletedStatusKey: 2 })] });
        contextMenuAt('task-1');
        await nextTick();
        expect(removeItem(wrapper).attributes('disabled')).toBeDefined();
        wrapper.unmount();
    });

    it('removes the dates, offers undo and remembers the span in storage', async () => {
        const wrapper = await openSettled({ tasks: [scheduledTask()] });
        contextMenuAt('task-1');
        await nextTick();

        removeItem(wrapper).trigger('click');
        await flushPromises();

        expect(updateDates).toHaveBeenCalledTimes(1);
        expect(updateDates).toHaveBeenCalledWith(expect.objectContaining({
            firebaseObj: { startDate: null, DueDate: null },
        }));
        expect(showUndoToast).toHaveBeenCalledWith(expect.objectContaining({ undo: expect.any(Function) }));
        expect(localStorage.getItem(spanKeyOf('task-1'))).toBe(String(day(6, 17) - day(4, 9)));
        expect(wrapper.find('.gv__menu').exists()).toBe(false);
        wrapper.unmount();
    });

    it('undo restores the exact previous dates and clears the remembered span', async () => {
        const task = scheduledTask();
        const wrapper = await openSettled({ tasks: [task] });
        contextMenuAt('task-1');
        await nextTick();
        removeItem(wrapper).trigger('click');
        await flushPromises();

        task.startDate = null;
        task.DueDate = null;
        await showUndoToast.mock.calls[0][0].undo();
        await flushPromises();

        expect(updateDates).toHaveBeenCalledTimes(2);
        expect(updateDates).toHaveBeenLastCalledWith(expect.objectContaining({
            firebaseObj: { startDate: day(4, 9), DueDate: day(6, 17) },
        }));
        expect(localStorage.getItem(spanKeyOf('task-1'))).toBeNull();
        wrapper.unmount();
    });

    it('undo refuses to overwrite dates set again after removal', async () => {
        const task = scheduledTask();
        const wrapper = await openSettled({ tasks: [task] });
        contextMenuAt('task-1');
        await nextTick();
        removeItem(wrapper).trigger('click');
        await flushPromises();

        task.startDate = day(10);
        task.DueDate = day(11);
        await showUndoToast.mock.calls[0][0].undo();
        await flushPromises();

        expect(updateDates).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalled();
        wrapper.unmount();
    });

    it('skips the undo toast and forgets the span when the remove write fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        updateDates.mockRejectedValueOnce(new Error('network'));
        const wrapper = await openSettled({ tasks: [scheduledTask()] });
        contextMenuAt('task-1');
        await nextTick();

        removeItem(wrapper).trigger('click');
        await flushPromises();

        expect(updateDates).toHaveBeenCalledTimes(1);
        expect(showUndoToast).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
        expect(localStorage.getItem(spanKeyOf('task-1'))).toBeNull();
        consoleError.mockRestore();
        wrapper.unmount();
    });

    it('closes the menu on timeline scroll and on ctrl+wheel zoom', async () => {
        const wrapper = await openSettled({ tasks: [scheduledTask()] });

        contextMenuAt('task-1');
        await nextTick();
        expect(wrapper.find('.gv__menu').exists()).toBe(true);
        handlers.onGanttScroll(0, 0);
        await nextTick();
        expect(wrapper.find('.gv__menu').exists()).toBe(false);

        settle();
        const before = width();
        contextMenuAt('task-1');
        await nextTick();
        expect(wrapper.find('.gv__menu').exists()).toBe(true);
        gantt.$root.dispatchEvent(ctrlWheel(-100));
        settle();
        await nextTick();
        expect(width()).not.toBe(before);
        expect(wrapper.find('.gv__menu').exists()).toBe(false);
        wrapper.unmount();
    });

    it('drops a tray task on the clicked day and restores its remembered three-day span', async () => {
        localStorage.setItem(spanKeyOf('tray-1'), String(3 * DAY_MS));
        const wrapper = await openSettled({ tasks: [scheduledTask(), trayTask()] });
        pinDropDate(day(12, 15));

        dragTrayTo(wrapper, 120);
        await flushPromises();

        expect(updateDates).toHaveBeenCalledTimes(1);
        expect(updateDates).toHaveBeenCalledWith(expect.objectContaining({
            taskData: expect.objectContaining({ _id: 'tray-1' }),
            firebaseObj: { startDate: day(12), DueDate: day(15) },
        }));
        expect(localStorage.getItem(spanKeyOf('tray-1'))).toBeNull();
        wrapper.unmount();
    });

    it('drops a tray task without a remembered span as a single day', async () => {
        const wrapper = await openSettled({ tasks: [scheduledTask(), trayTask()] });
        pinDropDate(day(12, 15));

        dragTrayTo(wrapper, 120);
        await flushPromises();

        expect(updateDates).toHaveBeenCalledWith(expect.objectContaining({
            firebaseObj: { startDate: day(12), DueDate: day(13) },
        }));
        wrapper.unmount();
    });

    it('ignores a tray drop while a shift preview is open, a task drag runs, or the pointer maps to no date', async () => {
        const shifting = await openSettled({ tasks: [scheduledTask(), trayTask()] });
        shifting.vm.$.setupState.shiftPreview = {
            id: 'task-1', task: scheduledTask(), from: { startDate: day(4, 9), DueDate: day(6, 17) }, to: {}, shifts: [], conflicts: [], cycle: [],
        };
        await nextTick();
        pinDropDate(day(12, 15));
        dragTrayTo(shifting, 120);
        await flushPromises();
        expect(updateDates).not.toHaveBeenCalled();
        shifting.unmount();
        dateSpy.mockRestore();

        const dragging = await openSettled({ tasks: [scheduledTask(), trayTask()] });
        gantt.dragged['task-1'] = { start_date: day(4, 9), end_date: day(6, 17) };
        expect(handlers.onBeforeTaskDrag('task-1')).toBe(true);
        pinDropDate(day(12, 15));
        dragTrayTo(dragging, 120);
        await flushPromises();
        expect(updateDates).not.toHaveBeenCalled();
        dragging.unmount();
        dateSpy.mockRestore();

        const unmapped = await openSettled({ tasks: [scheduledTask(), trayTask()] });
        pinDropDate(null);
        dragTrayTo(unmapped, 120);
        await flushPromises();
        expect(updateDates).not.toHaveBeenCalled();
        unmapped.unmount();
    });

    it('marks tray items draggable only when the user can edit dates', async () => {
        let wrapper = await openSettled({ canEdit: false, tasks: [trayTask()] });
        expect(wrapper.get('.gv__tray-item').attributes('draggable')).toBe('false');
        wrapper.unmount();

        wrapper = await openSettled({ tasks: [trayTask()] });
        expect(wrapper.get('.gv__tray-item').attributes('draggable')).toBe('true');
        wrapper.unmount();
    });

    it('removes the timeline drag listeners on unmount', async () => {
        const wrapper = await openSettled();
        const timeline = gantt.$task;
        const removeSpy = vi.spyOn(timeline, 'removeEventListener');

        wrapper.unmount();

        const removed = removeSpy.mock.calls.map(([type]) => type);
        expect(removed).toEqual(expect.arrayContaining(['dragover', 'dragleave', 'drop', 'mousedown']));
    });
});
