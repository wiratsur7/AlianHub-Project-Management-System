import { describe, expect, it } from 'vitest';
import {
    BOARD_GROUP_BATCH_SIZE,
    BOARD_GROUP_PAGE_SIZE,
    boardGroupFoundKey,
    boardGroupIndexKey,
    boardGroupPageBatches,
    boardGroupPageFlightKey,
    buildBoardGroupPageQuery,
    readBoardGroupPageBatch,
} from '@/store/ProjectData/boardTaskQueries';

const PID = '6aa3b13ed1b2a9fd26131a1e';
const LIST = '6aa3b13ed1b2a9fd26131a2f';
const group = (value) => ({ searchKey: 'statusKey', searchValue: value, indexName: 'groupByStatusIndex', conditions: [{ statusKey: { $eq: value } }] });

describe('Board aggregate query batches', () => {
    it('splits group sets into bounded batches', () => {
        const batches = boardGroupPageBatches(Array.from({ length: 17 }, (_, index) => group(index)));
        expect(batches.map((batch) => batch.length)).toEqual([BOARD_GROUP_BATCH_SIZE, BOARD_GROUP_BATCH_SIZE, 1]);
    });

    it('uses one list scope, separate non-nested page/count facets, and the 35-row cursor', () => {
        const items = [group(1), group(2)];
        const query = buildBoardGroupPageQuery({
            pid: PID, sprintId: LIST, items, cursors: { statusKey_1: 35 }, showAllTasks: false, userId: 'u1'
        });

        expect(query.inList).toBe(LIST);
        expect(query.findQuery[0].$match).toMatchObject({
            objId: { sprintId: LIST, ProjectID: PID }, isParentTask: true, deletedStatusKey: 0, AssigneeUserId: { $in: ['u1'] }
        });
        expect(query.findQuery[1].$facet.page_0).toEqual([
            { $match: { statusKey: { $eq: 1 } } },
            { $sort: { groupByStatusIndex: 1, createdAt: 1, _id: 1 } },
            { $skip: 35 },
            { $limit: BOARD_GROUP_PAGE_SIZE }
        ]);
        expect(query.findQuery[1].$facet.count_0).toEqual([
            { $match: { statusKey: { $eq: 1 } } }, { $count: 'count' }
        ]);
        expect(query.findQuery[1].$facet.page_0.some((stage) => '$facet' in stage)).toBe(false);
        expect(query.findQuery[1].$facet.page_0).toEqual(expect.arrayContaining([
            { $skip: 35 }, { $limit: BOARD_GROUP_PAGE_SIZE }
        ]));
    });

    it('reads empty groups as zero and keeps cursor/count per group', () => {
        const items = [group(1), group(2)];
        const entries = readBoardGroupPageBatch({
            items,
            cursors: { statusKey_1: 35 },
            facetDoc: {
                page_0: [{ _id: 'last', groupByStatusIndex: 40 }],
                count_0: [{ count: 36 }],
                page_1: [],
                count_1: []
            }
        });

        expect(entries.map(({ foundKey, indexKey, count, nextCursor, hasMore }) => ({ foundKey, indexKey, count, nextCursor, hasMore }))).toEqual([
            { foundKey: 'statusKey_1', indexKey: 'statusKey_1', count: 36, nextCursor: 36, hasMore: false },
            { foundKey: 'statusKey_2', indexKey: 'statusKey_2', count: 0, nextCursor: 0, hasMore: false }
        ]);
        expect(boardGroupFoundKey(items[0])).toBe('statusKey_1');
        expect(boardGroupIndexKey(items[1])).toBe('statusKey_2');
    });

    it('distinguishes in-flight requests by list, group and cursor', () => {
        const first = { pid: PID, sprintId: LIST, items: [group(1)], cursors: { statusKey_1: 0 }, showAllTasks: true };
        expect(boardGroupPageFlightKey(first)).toBe(boardGroupPageFlightKey(first));
        expect(boardGroupPageFlightKey(first)).not.toBe(boardGroupPageFlightKey({ ...first, cursors: { statusKey_1: 35 } }));
        expect(boardGroupPageFlightKey(first)).not.toBe(boardGroupPageFlightKey({ ...first, sprintId: `${LIST.slice(0, -1)}0` }));
    });
});
