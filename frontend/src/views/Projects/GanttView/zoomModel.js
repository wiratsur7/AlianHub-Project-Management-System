export const CANON = { Day: 160, Week: 10, Month: 3.5 };
export const MIN_PPD = 0.8;
export const MAX_PPD = 240;

const MIN_COLUMN_WIDTH = 14;
const HYSTERESIS = 0.08;
const UNIT_DAYS = new Map([
    ['hour', 1 / 24],
    ['day', 1],
    ['week', 7],
    ['month', 30.4],
]);

function withLast(scales) {
    const last = scales[scales.length - 1];
    return { scales, unit: last.unit, step: last.step };
}

export function clampPpd(ppd) {
    const value = Number(ppd);
    if (!Number.isFinite(value)) return null;
    return Math.min(MAX_PPD, Math.max(MIN_PPD, value));
}

export function bandFor(ppd, prevBand) {
    if (!Number.isFinite(ppd)) return prevBand || 'Week';
    if (prevBand === 'Day' && ppd >= 24 * (1 - HYSTERESIS)) return 'Day';
    if (prevBand === 'Week' && ppd >= 5 * (1 - HYSTERESIS) && ppd < 24 * (1 + HYSTERESIS)) return 'Week';
    if (prevBand === 'Month' && ppd < 5 * (1 + HYSTERESIS)) return 'Month';
    if (ppd < 5) return 'Month';
    if (ppd < 24) return 'Week';
    return 'Day';
}

export function scalesFor(ppd, band) {
    if (band === 'Day') {
        if (ppd < 48) {
            return withLast([
                { unit: 'week', step: 1, format: '%M %d' },
                { unit: 'day', step: 1, format: '%d' },
            ]);
        }
        if (ppd < 120) return withLast([{ unit: 'day', step: 1, format: '%d %M' }]);
        return withLast([
            { unit: 'day', step: 1, format: '%d %M' },
            { unit: 'hour', step: 6, format: '%H:%i' },
        ]);
    }
    if (band === 'Month') {
        const month = { unit: 'month', step: 1, format: '%F %Y' };
        if (ppd < 2.5) return withLast([month]);
        return withLast([month, { unit: 'week', step: 1, format: 'W%W' }]);
    }
    return withLast([{ unit: 'week', step: 1, format: '%M %d' }]);
}

export function minColumnWidth(ppd, unit, step) {
    const width = ppd * step * UNIT_DAYS.get(unit);
    if (!Number.isFinite(width)) return null;
    return Math.round(Math.max(MIN_COLUMN_WIDTH, width));
}

export function ppdFromScale(scale) {
    if (!scale) return null;
    const { unit, step, col_width: colWidth } = scale;
    const days = UNIT_DAYS.get(unit);
    if (days === undefined) return null;
    if (!(Number.isFinite(step) && step > 0)) return null;
    if (!(Number.isFinite(colWidth) && colWidth > 0)) return null;
    return colWidth / (step * days);
}

export function wheelFactor(event) {
    const mode = event?.deltaMode ?? 0;
    const raw = Number(event?.deltaY);
    if (!Number.isFinite(raw)) return 1;
    const scaled = mode === 1 ? raw * 16 : mode === 2 ? raw * 400 : raw;
    const dy = Math.max(-80, Math.min(80, scaled));
    const k = mode === 0 && Math.abs(dy) < 20 ? 0.01 : 0.002;
    return Math.exp(-dy * k);
}

export function storageKey(projectId) {
    return projectId ? `gantt.zoom.v1.${projectId}` : null;
}

export function readZoom(storage, key) {
    try {
        if (!storage || !key) return null;
        const raw = storage.getItem(key);
        if (raw === null || raw === undefined || String(raw).trim() === '') return null;
        return clampPpd(Number(raw));
    } catch {
        return null;
    }
}

export function writeZoom(storage, key, ppd) {
    try {
        const value = clampPpd(ppd);
        if (!storage || !key || value === null) return;
        storage.setItem(key, String(value));
    } catch {
        // storage can be full or blocked; zoom simply is not remembered
    }
}
