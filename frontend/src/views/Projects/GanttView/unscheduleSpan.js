export const DAY = 86400000;

export function spanKey(projectId, taskId) {
    return `gantt.span.v1.${projectId}.${taskId}`;
}

export function rememberSpan(storage, projectId, taskId, ms) {
    try {
        if (!storage) return;
        storage.setItem(spanKey(projectId, taskId), String(ms));
    } catch {
        // storage can be full or blocked; the span is simply not remembered
    }
}

export function takeSpan(storage, projectId, taskId) {
    try {
        if (!storage) return DAY;
        const key = spanKey(projectId, taskId);
        const raw = storage.getItem(key);
        storage.removeItem(key);
        const ms = Number(raw);
        if (raw === null || raw === undefined || !Number.isFinite(ms) || ms <= 0) return DAY;
        return Math.max(1, Math.round(ms / DAY)) * DAY;
    } catch {
        return DAY;
    }
}
