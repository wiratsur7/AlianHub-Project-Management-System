import { groupCondition, sprintTaskMatch } from './taskQueries';

export const BOARD_GROUP_PAGE_SIZE = 35;
export const BOARD_GROUP_BATCH_SIZE = 8;

const flightMap = new Map();

const textOf = (value) => String(value);

/* These keys deliberately match ProjectData/actions.js so Board pages share the existing per-list cursor. */
export function boardGroupIndexKey(item, parentId = '') {
    return `${parentId ? `${parentId}_` : ''}${item?.searchKey}_${item?.searchValue}`;
}

export function boardGroupFoundKey(item) {
    return `${item?.searchKey}_${item?.searchValue}`;
}

export function boardGroupPageBatches(items = []) {
    const groups = Array.isArray(items) ? items : [];
    const batches = [];
    for (let offset = 0; offset < groups.length; offset += BOARD_GROUP_BATCH_SIZE) {
        batches.push(groups.slice(offset, offset + BOARD_GROUP_BATCH_SIZE));
    }
    return batches;
}

const cursorAt = (cursors, indexKey) => {
    const value = cursors?.[indexKey];
    return Number.isInteger(value) && value >= 0 ? value : 0;
};

/* A batch is one list and at most eight groups. The root match is intentionally shared so the
   server can widen it for this single `inList`; facet branches then apply each group's predicate. */
export function buildBoardGroupPageQuery({ pid, sprintId, items = [], cursors = {}, showAllTasks, userId } = {}) {
    const groups = Array.isArray(items) ? items : [];
    if (groups.length > BOARD_GROUP_BATCH_SIZE) {
        throw new RangeError(`A Board page batch accepts at most ${BOARD_GROUP_BATCH_SIZE} groups`);
    }
    if (!groups.length) return { findQuery: [], inList: sprintId, entries: [] };

    const entries = groups.map((item, at) => {
        const indexKey = boardGroupIndexKey(item);
        return {
            item,
            indexKey,
            foundKey: boardGroupFoundKey(item),
            cursor: cursorAt(cursors, indexKey),
            pageFacet: `page_${at}`,
            countFacet: `count_${at}`,
        };
    });
    const facets = {};

    entries.forEach((entry) => {
        const condition = groupCondition(entry.item);
        const indexName = entry.item?.indexName || 'groupByStatusIndex';
        facets[entry.pageFacet] = [
            { $match: condition },
            { $sort: { [indexName]: 1, createdAt: 1, _id: 1 } },
            { $skip: entry.cursor },
            { $limit: BOARD_GROUP_PAGE_SIZE },
        ];
        facets[entry.countFacet] = [
            { $match: condition },
            { $count: 'count' },
        ];
    });

    return {
        findQuery: [
            {
                $match: {
                    ...sprintTaskMatch({ pid, sprintId, showAllTasks, userId }),
                    isParentTask: true,
                },
            },
            { $facet: facets },
        ],
        inList: sprintId,
        entries,
    };
}

/* The request key includes item order because facet names are positional, and every per-group cursor
   because a refresh at a different offset is a different read. */
export function boardGroupPageFlightKey({ pid, sprintId, items = [], cursors = {}, showAllTasks, userId } = {}) {
    const visibility = showAllTasks === undefined || showAllTasks === true || showAllTasks === 2
        ? ['all']
        : ['assigned', textOf(userId ?? '')];
    const groups = (Array.isArray(items) ? items : []).map((item) => [
        boardGroupIndexKey(item),
        boardGroupFoundKey(item),
        cursorAt(cursors, boardGroupIndexKey(item)),
    ]);
    return JSON.stringify([textOf(pid ?? ''), textOf(sprintId ?? ''), visibility, groups]);
}

/* A batch can be requested by mount and a watcher in the same tick. Return the same in-flight
   promise, and remove only the promise this caller installed when it settles. */
export function coalesceBoardGroupPageFlight(key, load) {
    if (flightMap.has(key)) return flightMap.get(key);

    const flight = Promise.resolve().then(load);
    let tracked;
    tracked = flight.finally(() => {
        if (flightMap.get(key) === tracked) flightMap.delete(key);
    });
    flightMap.set(key, tracked);
    return tracked;
}

export function readBoardGroupPageBatch({ items = [], facetDoc = {}, cursors = {} } = {}) {
    return (Array.isArray(items) ? items : []).map((item, at) => {
        const indexKey = boardGroupIndexKey(item);
        const cursor = cursorAt(cursors, indexKey);
        const rows = Array.isArray(facetDoc?.[`page_${at}`]) ? facetDoc[`page_${at}`] : [];
        const count = Number(facetDoc?.[`count_${at}`]?.[0]?.count) || 0;
        const nextCursor = cursor + rows.length;
        return {
            item,
            indexKey,
            foundKey: boardGroupFoundKey(item),
            rows,
            count,
            nextCursor,
            hasMore: nextCursor < count,
        };
    });
}
