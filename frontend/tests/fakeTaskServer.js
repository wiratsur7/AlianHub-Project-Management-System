/* A stand-in for POST /task/find over a list of task rows: the parts of $match, $skip, $limit,
   $facet and the subtask count $group that the List, Board, Table and Calendar loaders send.
   Rows come back in group-index order. Any other request is recorded in `posts`. */
import { vi } from 'vitest';

export const server = { tasks: [], calls: [], posts: [] };

export function resetServer(tasks = []) {
    server.tasks = tasks;
    server.calls = [];
    server.posts = [];
}

const holds = (value, want) => {
    if (want && typeof want === 'object' && !Array.isArray(want)) {
        if ('objId' in want) return holds(value, want.objId);
        if ('$eq' in want) return value === want.$eq;
        if ('$in' in want) return want.$in.includes(value);
    }
    return value === want;
};

const matches = (task, condition = {}) => Object.entries(condition).every(([field, want]) => {
    if (field === '$and') return want.every((part) => matches(task, part));
    if (field === 'objId') return Object.entries(want).every(([key, value]) => task[key] === value);
    return holds(task[field], want);
});

const stage = (stages, name) => stages.find((entry) => name in entry)?.[name];
const copy = (task) => ({ ...task });
const inOrder = (a, b) => ((a.groupByStatusIndex ?? 0) - (b.groupByStatusIndex ?? 0)) || (a._id > b._id ? 1 : -1);

function childCounts(rows) {
    const byParent = new Map();
    rows.forEach((task) => {
        const entry = byParent.get(task.ParentTaskId) || { _id: task.ParentTaskId, total: 0, completed: 0 };
        entry.total += 1;
        if (task.statusType === 'close') entry.completed += 1;
        byParent.set(task.ParentTaskId, entry);
    });
    return [...byParent.values()];
}

function sortRows(rows, fields = {}) {
    const keys = Object.entries(fields);
    return [...rows].sort((a, b) => {
        for (const [field, direction] of keys) {
            const left = a[field] ?? null;
            const right = b[field] ?? null;
            if (left === right) continue;
            if (left === null) return -1 * direction;
            if (right === null) return direction;
            if (left < right) return -1 * direction;
            if (left > right) return direction;
        }
        return 0;
    });
}

function runFacetBranch(rows, pipeline) {
    let result = [...rows];
    for (const item of pipeline || []) {
        if ('$match' in item) result = result.filter((task) => matches(task, item.$match));
        else if ('$sort' in item) result = sortRows(result, item.$sort);
        else if ('$skip' in item) result = result.slice(item.$skip);
        else if ('$limit' in item) result = result.slice(0, item.$limit);
        else if ('$count' in item) return result.length ? [{ [item.$count]: result.length }] : [];
    }
    return result.map(copy);
}

function answer(stages, inList) {
    const rootMatch = stage(stages, '$match');
    const rows = server.tasks.filter((task) => {
        if (matches(task, rootMatch)) return true;
        if (!inList || !task.extraLists?.some((entry) => String(entry.sprintId) === String(inList))) return false;
        return matches({ ...task, sprintId: inList }, rootMatch);
    }).sort(inOrder);
    const facet = stage(stages, '$facet');
    if (facet?.result) {
        const skip = stage(facet.result, '$skip') || 0;
        return [{ result: rows.slice(skip, skip + 35).map(copy), count: rows.length ? [{ count: rows.length }] : [] }];
    }
    if (facet) {
        return [Object.fromEntries(Object.entries(facet).map(([key, pipeline]) => [key, runFacetBranch(rows, pipeline)]))];
    }
    if (stage(stages, '$group')) return childCounts(rows);
    const skip = stage(stages, '$skip') || 0;
    const limit = stage(stages, '$limit');
    return (limit ? rows.slice(skip, skip + limit) : rows).map(copy);
}

export const apiRequest = vi.fn((method, url, body) => {
    const stages = body?.findQuery;
    if (!Array.isArray(stages)) {
        server.posts.push({ method, url, body });
        return Promise.resolve({ status: 200, data: { status: true } });
    }
    server.calls.push(stages);
    return Promise.resolve({ status: 200, data: answer(stages, body?.inList) });
});

const readsOf = (parentId) => (stages) => stage(stages, '$match')?.ParentTaskId === parentId;

export const childReads = (parentId) => server.calls.filter(readsOf(parentId));
