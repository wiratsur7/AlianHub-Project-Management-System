import { describe, expect, it } from 'vitest';
import {
    CANON,
    MAX_PPD,
    MIN_PPD,
    bandFor,
    clampPpd,
    minColumnWidth,
    ppdFromScale,
    readZoom,
    scalesFor,
    storageKey,
    wheelFactor,
    writeZoom,
} from '@/views/Projects/GanttView/zoomModel';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
    };
}

const throwingStorage = {
    getItem() {
        throw new Error('storage blocked');
    },
    setItem() {
        throw new Error('quota exceeded');
    },
};

describe('a Gantt zoom level', () => {
    it('is clamped into the supported range', () => {
        expect(clampPpd(0)).toBe(MIN_PPD);
        expect(clampPpd(1000)).toBe(MAX_PPD);
        expect(clampPpd(10)).toBe(10);
        expect(clampPpd(NaN)).toBeNull();
    });

    it('keeps the canonical pixels-per-day for each band', () => {
        expect(CANON).toEqual({ Day: 160, Week: 10, Month: 3.5 });
    });
});

describe('a Gantt zoom band', () => {
    it('is Month below 5, Week from 5 to below 24, and Day from 24 up', () => {
        expect(bandFor(1)).toBe('Month');
        expect(bandFor(4.99)).toBe('Month');
        expect(bandFor(5)).toBe('Week');
        expect(bandFor(23.99)).toBe('Week');
        expect(bandFor(24)).toBe('Day');
        expect(bandFor(40)).toBe('Day');
    });

    it('stays Day when it drops just under 24 from Day', () => {
        expect(bandFor(23, 'Day')).toBe('Day');
        expect(bandFor(22.1, 'Day')).toBe('Day');
    });

    it('becomes Week once it drops more than 8% under 24 from Day', () => {
        expect(bandFor(22, 'Day')).toBe('Week');
        expect(bandFor(21, 'Day')).toBe('Week');
    });

    it('stays Week when it rises just over 24 from Week', () => {
        expect(bandFor(25, 'Week')).toBe('Week');
    });

    it('becomes Day once it rises more than 8% over 24 from Week', () => {
        expect(bandFor(26, 'Week')).toBe('Day');
    });

    it('stays Week when it drops just under 5 from Week', () => {
        expect(bandFor(4.7, 'Week')).toBe('Week');
    });

    it('becomes Month once it drops more than 8% under 5 from Week', () => {
        expect(bandFor(4.5, 'Week')).toBe('Month');
    });

    it('stays Month when it rises just over 5 from Month', () => {
        expect(bandFor(5.3, 'Month')).toBe('Month');
    });

    it('becomes Week once it rises more than 8% over 5 from Month', () => {
        expect(bandFor(5.5, 'Month')).toBe('Week');
    });

    it('ignores the previous band when the level is far from any threshold', () => {
        expect(bandFor(10, 'Day')).toBe('Week');
        expect(bandFor(40, 'Month')).toBe('Day');
    });
});

describe('a Gantt zoom detail level', () => {
    it('shows week and day headers below 48 pixels per day', () => {
        expect(scalesFor(40, 'Day')).toEqual({
            scales: [
                { unit: 'week', step: 1, format: '%M %d' },
                { unit: 'day', step: 1, format: '%d' },
            ],
            unit: 'day',
            step: 1,
        });
    });

    it('shows a single day header from 48 up to below 120 pixels per day', () => {
        expect(scalesFor(48, 'Day')).toEqual({
            scales: [{ unit: 'day', step: 1, format: '%d %M' }],
            unit: 'day',
            step: 1,
        });
        expect(scalesFor(119, 'Day').unit).toBe('day');
        expect(scalesFor(119, 'Day').scales).toHaveLength(1);
    });

    it('adds six-hour headers from 120 pixels per day up', () => {
        expect(scalesFor(120, 'Day')).toEqual({
            scales: [
                { unit: 'day', step: 1, format: '%d %M' },
                { unit: 'hour', step: 6, format: '%H:%i' },
            ],
            unit: 'hour',
            step: 6,
        });
    });

    it('shows week headers only in the Week band', () => {
        expect(scalesFor(10, 'Week')).toEqual({
            scales: [{ unit: 'week', step: 1, format: '%M %d' }],
            unit: 'week',
            step: 1,
        });
    });

    it('shows month headers with week sub-headers in the Month band', () => {
        expect(scalesFor(3, 'Month')).toEqual({
            scales: [
                { unit: 'month', step: 1, format: '%F %Y' },
                { unit: 'week', step: 1, format: 'W%W' },
            ],
            unit: 'week',
            step: 1,
        });
    });

    it('drops the week sub-header in the Month band below 2.5 pixels per day', () => {
        expect(scalesFor(2.4, 'Month')).toEqual({
            scales: [{ unit: 'month', step: 1, format: '%F %Y' }],
            unit: 'month',
            step: 1,
        });
        expect(scalesFor(2.5, 'Month').scales).toHaveLength(2);
    });
});

describe('a Gantt column width', () => {
    it('is the pixels of one hour step at the given zoom', () => {
        expect(minColumnWidth(240, 'hour', 6)).toBe(60);
    });

    it('is floored at 14 pixels', () => {
        expect(minColumnWidth(0.8, 'week', 1)).toBe(14);
        expect(minColumnWidth(10, 'day', 1)).toBe(14);
        expect(minColumnWidth(0.8, 'hour', 1)).toBe(14);
    });

    it('is the pixels of one day step at the given zoom', () => {
        expect(minColumnWidth(20, 'day', 1)).toBe(20);
    });

    it('is seven days of pixels for a week step', () => {
        expect(minColumnWidth(10, 'week', 1)).toBe(70);
    });

    it('is thirty point four days of pixels for a month step', () => {
        expect(minColumnWidth(3.5, 'month', 1)).toBe(106);
    });

    it('is rounded to a whole pixel', () => {
        expect(minColumnWidth(15.4, 'day', 1)).toBe(15);
        expect(minColumnWidth(15.6, 'day', 1)).toBe(16);
    });
});

describe('a Gantt zoom read back from a column width', () => {
    it('recovers the zoom it was measured from', () => {
        expect(ppdFromScale({ unit: 'day', step: 1, col_width: 120 })).toBe(120);
        expect(ppdFromScale({ unit: 'week', step: 1, col_width: 70 })).toBe(10);
        expect(ppdFromScale({ unit: 'hour', step: 6, col_width: 40 })).toBeCloseTo(160, 6);
    });

    it('round trips through minColumnWidth', () => {
        const day = minColumnWidth(20, 'day', 1);
        expect(ppdFromScale({ unit: 'day', step: 1, col_width: day })).toBe(20);
        const week = minColumnWidth(10, 'week', 1);
        expect(ppdFromScale({ unit: 'week', step: 1, col_width: week })).toBe(10);
        const hour = minColumnWidth(160, 'hour', 6);
        expect(ppdFromScale({ unit: 'hour', step: 6, col_width: hour })).toBeCloseTo(160, 6);
        const month = minColumnWidth(4, 'month', 1);
        expect(ppdFromScale({ unit: 'month', step: 1, col_width: month })).toBeCloseTo(4, 1);
    });

    it('is null for a missing scale, unknown unit, bad step or bad width', () => {
        expect(ppdFromScale()).toBeNull();
        expect(ppdFromScale(null)).toBeNull();
        expect(ppdFromScale({ unit: 'year', step: 1, col_width: 50 })).toBeNull();
        expect(ppdFromScale({ unit: 'day', step: 0, col_width: 50 })).toBeNull();
        expect(ppdFromScale({ unit: 'day', step: 1, col_width: NaN })).toBeNull();
        expect(ppdFromScale({ unit: 'day', step: 1, col_width: 0 })).toBeNull();
        expect(ppdFromScale({ unit: 'day', step: 1, col_width: Infinity })).toBeNull();
    });
});

describe('a Gantt wheel zoom step', () => {
    it('zooms in for a downward scroll of 100 pixels', () => {
        expect(wheelFactor({ deltaY: 100, deltaMode: 0 })).toBeLessThan(1);
    });

    it('zooms out for an upward scroll of 100 pixels', () => {
        expect(wheelFactor({ deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1);
    });

    it('treats line deltas as sixteen pixels each', () => {
        expect(wheelFactor({ deltaY: 5, deltaMode: 1 })).toBeCloseTo(wheelFactor({ deltaY: 100, deltaMode: 0 }));
    });

    it('treats page deltas as four hundred pixels each, clamped like a large scroll', () => {
        expect(wheelFactor({ deltaY: 1, deltaMode: 2 })).toBeCloseTo(wheelFactor({ deltaY: 100, deltaMode: 0 }));
    });

    it('uses the gentle pinch rate for small pixel deltas', () => {
        expect(wheelFactor({ deltaY: 10, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.1));
        expect(wheelFactor({ deltaY: 19, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.19));
    });

    it('uses the mouse wheel rate once the delta reaches 20 pixels', () => {
        expect(wheelFactor({ deltaY: 20, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.04));
    });

    it('clamps the delta to 80 before applying the rate', () => {
        expect(wheelFactor({ deltaY: 500, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.16));
        expect(wheelFactor({ deltaY: -500, deltaMode: 0 })).toBeCloseTo(Math.exp(0.16));
    });

    it('is one for a non-finite delta', () => {
        expect(wheelFactor({ deltaY: NaN, deltaMode: 0 })).toBe(1);
        expect(wheelFactor({})).toBe(1);
        expect(wheelFactor()).toBe(1);
    });
});

describe('a Gantt zoom storage key', () => {
    it('is namespaced by the project id', () => {
        expect(storageKey('p1')).toBe('gantt.zoom.v1.p1');
    });

    it('is absent when there is no project id', () => {
        expect(storageKey('')).toBeNull();
        expect(storageKey(null)).toBeNull();
        expect(storageKey(undefined)).toBeNull();
    });
});

describe('a remembered Gantt zoom', () => {
    const key = 'gantt.zoom.v1.p1';

    it('is read back as the stored number', () => {
        expect(readZoom(memoryStorage({ [key]: '12' }), key)).toBe(12);
    });

    it('is clamped into the supported range when read', () => {
        expect(readZoom(memoryStorage({ [key]: '1000' }), key)).toBe(MAX_PPD);
        expect(readZoom(memoryStorage({ [key]: '0.1' }), key)).toBe(MIN_PPD);
    });

    it('is null when the stored value is garbage, NaN, empty or missing', () => {
        expect(readZoom(memoryStorage({ [key]: 'abc' }), key)).toBeNull();
        expect(readZoom(memoryStorage({ [key]: 'NaN' }), key)).toBeNull();
        expect(readZoom(memoryStorage({ [key]: 'Infinity' }), key)).toBeNull();
        expect(readZoom(memoryStorage({ [key]: '   ' }), key)).toBeNull();
        expect(readZoom(memoryStorage(), key)).toBeNull();
    });

    it('is null and never throws when the storage is absent or blocked', () => {
        expect(readZoom(null, key)).toBeNull();
        expect(readZoom(undefined, key)).toBeNull();
        expect(readZoom(memoryStorage({ [key]: '12' }), null)).toBeNull();
        expect(() => readZoom(throwingStorage, key)).not.toThrow();
        expect(readZoom(throwingStorage, key)).toBeNull();
    });

    it('is written as the clamped number', () => {
        const storage = memoryStorage();
        writeZoom(storage, key, 12);
        expect(storage.data.get(key)).toBe('12');
        writeZoom(storage, key, 1000);
        expect(storage.data.get(key)).toBe(String(MAX_PPD));
    });

    it('is not written for a non-finite zoom', () => {
        const storage = memoryStorage();
        writeZoom(storage, key, NaN);
        writeZoom(storage, key, Infinity);
        expect(storage.data.has(key)).toBe(false);
    });

    it('is ignored without throwing when the storage is absent or blocked', () => {
        expect(() => writeZoom(null, key, 12)).not.toThrow();
        expect(() => writeZoom(throwingStorage, key, 12)).not.toThrow();
        expect(() => writeZoom(memoryStorage(), null, 12)).not.toThrow();
    });
});
