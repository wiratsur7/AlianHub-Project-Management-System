import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { apiRequest, tableSortStages } = vi.hoisted(() => ({ apiRequest: vi.fn(), tableSortStages: vi.fn() }));
vi.mock('../../src/services/index', () => ({ apiRequest }));
vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));
vi.mock('@/views/Projects/composables/customFieldQuery', () => ({ tableSortStages }));

import projectData from '@/store/ProjectData';

const initialState = () => structuredClone({
    allProjects: [], tasks: {}, tableTasks: {}, tableGroupCounts: {}, estimates: [], closeProjects: [], items: [],
    currentProjectDetails: {}, searchedTasks: [], otherProjectChanges: 0, searchedProjects: [], projectTemplate: [],
    defaultTemplate: [], mongoUpdatedTask: {}, sprints: {}, folders: {}, getTaskSnapShotPayload: {},
    getPaginatedTaskPayload: [], getTableTaskPayload: [], taskDetailData: {}, taskDetailPayloadId: {}, allTaskData: []
});

const buildStore = () => createStore({
    modules: {
        settings: { namespaced: true, state: {}, getters: { finalCustomFields: () => [] } },
        users: { namespaced: true, getters: { users: () => [] } },
        projectData: { ...projectData, state: initialState }
    }
});

const group = (statusKey) => ({
    key: `statusKey_${statusKey}`,
    searchKey: 'statusKey',
    searchValue: statusKey,
    indexName: 'groupByStatusIndex',
    conditions: [{ statusKey: { $eq: statusKey } }]
});

const task = (id, homeList, statusKey, extraLists = []) => ({
    _id: id,
    TaskName: id,
    ProjectID: 'p1',
    sprintId: homeList,
    extraLists,
    isParentTask: true,
    ParentTaskId: '',
    statusKey,
    groupByStatusIndex: Number(id.replace(/\D/g, '')) || 1,
    createdAt: 1
});

const pageData = (facet) => ({ status: 200, data: [facet] });

let store;
beforeEach(() => {
    apiRequest.mockReset();
    tableSortStages.mockReset();
    store = buildStore();
});
afterEach(() => vi.useRealTimers());

describe('Board grouped pages', () => {
    it('loads grouped pages and exact counts per list in one request per batch', async () => {
        const shared = task('t1', 's1', 1, [{ projectId: 'p1', sprintId: 's2' }]);
        apiRequest.mockImplementation((_method, _url, body) => {
            const listId = body.inList;
            const facets = body.findQuery[1].$facet;
            const result = {};
            Object.keys(facets).forEach((key) => {
                const index = Number(key.split('_')[1]);
                if (key.startsWith('page_')) {
                    result[key] = listId === 's1' && index === 0
                        ? [shared, ...Array.from({ length: 34 }, (_, at) => task(`a${at + 2}`, 's1', 1))]
                        : listId === 's2' && index === 0 ? [shared] : [];
                } else {
                    result[key] = [{ count: listId === 's1' && index === 0 ? 36 : listId === 's2' && index === 0 ? 1 : 0 }];
                }
            });
            return Promise.resolve(pageData(result));
        });

        const result = await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1',
            buckets: [
                { sprintId: 's1', items: [group(1), group(2)] },
                { sprintId: 's2', items: [group(1), group(2)] }
            ],
            showAllTasks: true,
            userId: 'u1',
            firstPageOnly: true,
            fetchNew: true
        });

        expect(result.failed).toEqual([]);
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(apiRequest.mock.calls.map((call) => call[2].inList).sort()).toEqual(['s1', 's2']);
        expect(apiRequest.mock.calls.every((call) => Object.keys(call[2].findQuery[1].$facet).length === 4)).toBe(true);
        expect(store.state.projectData.tasks.p1.s1.tasks.map((row) => row._id)).toHaveLength(35);
        expect(store.state.projectData.tasks.p1.s2.tasks.map((row) => row._id)).toEqual(['t1']);
        expect(store.state.projectData.tasks.p1.s1.found).toEqual({ statusKey_1: 36, statusKey_2: 0 });
        expect(store.state.projectData.tasks.p1.s2.found).toEqual({ statusKey_1: 1, statusKey_2: 0 });
        expect(store.state.projectData.tasks.p1.s2.tasks[0].sprintId).toBe('s1');
        expect(apiRequest.mock.calls.every((call) => call[2].findQuery[0].$match.objId.sprintId === call[2].inList)).toBe(true);
    });

    it('loads more only for selected list/group buckets that still have rows', async () => {
        store.commit('projectData/mutateTypesenseTasks', { pid: 'p1', sprintId: 's1', found: { statusKey_1: 36 }, nextPage: { statusKey_1: 35 }, data: null });
        store.commit('projectData/mutateTypesenseTasks', { pid: 'p1', sprintId: 's2', found: { statusKey_1: 35 }, nextPage: { statusKey_1: 35 }, data: null });
        apiRequest.mockImplementation(() => {
            return Promise.resolve(pageData({ page_0: [task('a36', 's1', 1)], count_0: [{ count: 36 }] }));
        });

        await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1', buckets: [{ sprintId: 's1', items: [group(1)] }], showAllTasks: true, fetchNew: true
        });

        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(apiRequest.mock.calls[0][2].inList).toBe('s1');
        expect(apiRequest.mock.calls[0][2].findQuery[1].$facet.page_0[2]).toEqual({ $skip: 35 });
        expect(store.state.projectData.tasks.p1.s1.index.statusKey_1).toBe(36);
    });

    it.each([
        {
            label: 'deleted',
            op: 'removed',
            update: (row) => row,
            updatedFields: {}
        },
        {
            label: 'moved out of the group',
            op: 'modified',
            update: (row) => ({ ...row, statusKey: 2 }),
            updatedFields: { statusKey: 2 }
        }
    ])('recomputes the page offset after a loaded row is $label', async ({ op, update, updatedFields }) => {
        const rows = Array.from({ length: 35 }, (_, at) => task(`a${at + 1}`, 's1', 1));
        apiRequest.mockResolvedValue(pageData({ page_0: rows, count_0: [{ count: 36 }] }));
        await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1', buckets: [{ sprintId: 's1', items: [group(1)] }], showAllTasks: true, firstPageOnly: true, fetchNew: true
        });

        const changed = rows[0];
        store.commit('projectData/mutateUpdateFirebaseTasks', {
            snap: {}, op, pid: 'p1', sprintId: 's1', data: update(changed), updatedFields, membershipScoped: true
        });
        if (op === 'modified') {
            expect(store.state.projectData.tasks.p1.s1.tasks.some((row) => row._id === changed._id)).toBe(true);
        }

        apiRequest.mockResolvedValue(pageData({ page_0: [task('a36', 's1', 1)], count_0: [{ count: 35 }] }));
        await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1', buckets: [{ sprintId: 's1', items: [group(1)] }], showAllTasks: true, fetchNew: true
        });

        const pageStages = apiRequest.mock.calls.at(-1)[2].findQuery[1].$facet.page_0;
        expect(pageStages.find((stage) => '$skip' in stage)).toEqual({ $skip: 34 });
    });

    it('loads a group with a stale zero count when only a subtask cursor exists', async () => {
        store.commit('projectData/mutateTypesenseTasks', {
            pid: 'p1', sprintId: 's1', found: { statusKey_1: 0 }, nextPage: { t1_statusKey_1: 2 }, data: null
        });
        apiRequest.mockResolvedValue(pageData({ page_0: [task('a1', 's1', 1)], count_0: [{ count: 1 }] }));

        await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1', buckets: [{ sprintId: 's1', items: [group(1)] }], showAllTasks: true, firstPageOnly: true, fetchNew: true
        });

        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(store.state.projectData.tasks.p1.s1.tasks.map((row) => row._id)).toEqual(['a1']);
    });

    it('keeps successful lists visible and returns the failed batch for retry', async () => {
        apiRequest.mockImplementation((_method, _url, body) => {
            if (body.inList === 's2') return Promise.reject(new Error('offline'));
            return Promise.resolve(pageData({ page_0: [task('a1', 's1', 1)], count_0: [{ count: 1 }] }));
        });

        const result = await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1',
            buckets: [{ sprintId: 's1', items: [group(1)] }, { sprintId: 's2', items: [group(1)] }],
            showAllTasks: true,
            firstPageOnly: true,
            fetchNew: true
        });

        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toMatchObject({ sprintId: 's2', groupKeys: ['statusKey_1'] });
        expect(store.state.projectData.tasks.p1.s1.tasks.map((row) => row._id)).toEqual(['a1']);
        expect(store.state.projectData.tasks.p1.s2).toBeUndefined();
    });

    it('coalesces concurrent requests for the same list, groups, and cursors', async () => {
        let release;
        apiRequest.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const payload = { pid: 'p1', buckets: [{ sprintId: 's1', items: [group(1)] }], showAllTasks: true, firstPageOnly: true, fetchNew: true };
        const first = store.dispatch('projectData/getBoardGroupPages', payload);
        const second = store.dispatch('projectData/getBoardGroupPages', payload);
        await Promise.resolve();
        release(pageData({ page_0: [task('a1', 's1', 1)], count_0: [{ count: 1 }] }));

        await Promise.all([first, second]);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(store.state.projectData.tasks.p1.s1.tasks.map((row) => row._id)).toEqual(['a1']);
    });

    it('keeps no more than four list batches active', async () => {
        let active = 0;
        let maximum = 0;
        apiRequest.mockImplementation((_method, _url, body) => new Promise((resolve) => {
            active += 1;
            maximum = Math.max(maximum, active);
            setTimeout(() => {
                active -= 1;
                resolve(pageData({ page_0: [task(`${body.inList}-1`, body.inList, 1)], count_0: [{ count: 1 }] }));
            }, 3);
        }));

        await store.dispatch('projectData/getBoardGroupPages', {
            pid: 'p1',
            buckets: Array.from({ length: 10 }, (_, at) => ({ sprintId: `s${at}`, items: [group(1)] })),
            showAllTasks: true,
            firstPageOnly: true,
            fetchNew: true
        });

        expect(maximum).toBe(4);
    });
});
