import { describe, expect, it } from 'vitest';
import { growTimelineRange, includeTimelineDates, initialTimelineRange } from '@/views/Projects/GanttView/timelineRange';

const date = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const ymdh = (value) => [value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes()];

describe('initialTimelineRange', () => {
    it('pads the task extent by one visible viewport span on both sides', () => {
        const first = date(2026, 2, 1, 9, 30);
        const last = date(2026, 2, 4, 17, 15);
        const range = initialTimelineRange({
            taskDates: [last, first],
            viewportStart: date(2026, 2, 10, 8),
            viewportEnd: date(2026, 2, 20, 8),
        });

        expect(ymdh(range.startDate)).toEqual([2026, 1, 22, 9, 30]);
        expect(ymdh(range.endDate)).toEqual([2026, 2, 14, 17, 15]);
        expect(ymdh(first)).toEqual([2026, 2, 1, 9, 30]);
        expect(ymdh(last)).toEqual([2026, 2, 4, 17, 15]);
    });

    it('returns null bounds when there are no valid task dates', () => {
        expect(initialTimelineRange({ taskDates: [null, new Date(NaN)] })).toEqual({ startDate: null, endDate: null });
    });

    it('uses a one-calendar-day minimum when the viewport has no positive span', () => {
        const taskDate = date(2026, 6, 10, 12);
        const range = initialTimelineRange({ taskDates: [taskDate], viewportStart: taskDate, viewportEnd: taskDate });
        expect(ymdh(range.startDate)).toEqual([2026, 6, 9, 12, 0]);
        expect(ymdh(range.endDate)).toEqual([2026, 6, 11, 12, 0]);
    });

    it('pads with calendar days across daylight-saving time and keeps the local hour', () => {
        const previousTimezone = process.env.TZ;
        process.env.TZ = 'America/New_York';
        try {
            const viewportStart = date(2026, 3, 7, 12);
            const viewportEnd = date(2026, 3, 8, 12);
            const taskDate = date(2026, 3, 8, 12);
            const range = initialTimelineRange({ taskDates: [taskDate], viewportStart, viewportEnd });

            expect((viewportEnd.getTime() - viewportStart.getTime()) / (60 * 60 * 1000)).toBe(23);
            expect(ymdh(range.startDate)).toEqual([2026, 3, 7, 12, 0]);
            expect(ymdh(range.endDate)).toEqual([2026, 3, 9, 12, 0]);
        } finally {
            if (previousTimezone === undefined) delete process.env.TZ;
            else process.env.TZ = previousTimezone;
        }
    });
});

describe('growTimelineRange', () => {
    const range = () => ({ rangeStart: date(2026, 1, 1, 9), rangeEnd: date(2026, 1, 11, 9) });

    it('extends both sides when both visible edges are within one viewport span', () => {
        const grown = growTimelineRange({
            ...range(),
            visibleStart: date(2026, 1, 2, 9),
            visibleEnd: date(2026, 1, 9, 9),
        });
        expect(ymdh(grown.startDate)).toEqual([2025, 12, 25, 9, 0]);
        expect(ymdh(grown.endDate)).toEqual([2026, 1, 18, 9, 0]);
    });

    it('does not repeatedly grow for an unchanged viewport at both boundaries', () => {
        const original = { rangeStart: date(2026, 1, 1, 9), rangeEnd: date(2026, 1, 8, 9) };
        const viewport = { visibleStart: date(2026, 1, 1, 9), visibleEnd: date(2026, 1, 8, 9) };
        const first = growTimelineRange({ ...original, ...viewport });
        const second = growTimelineRange({ rangeStart: first.startDate, rangeEnd: first.endDate, ...viewport });

        expect(ymdh(first.startDate)).toEqual([2025, 12, 25, 9, 0]);
        expect(ymdh(first.endDate)).toEqual([2026, 1, 15, 9, 0]);
        expect(second).toEqual(first);
    });

    it('leaves one viewport span around an edge that is already outside the range', () => {
        const bounds = { rangeStart: date(2026, 1, 1, 9), rangeEnd: date(2026, 6, 1, 9) };
        const viewport = { visibleStart: date(2025, 12, 31, 9), visibleEnd: date(2026, 1, 7, 9) };
        const first = growTimelineRange({ ...bounds, ...viewport });
        const second = growTimelineRange({ rangeStart: first.startDate, rangeEnd: first.endDate, ...viewport });

        expect(ymdh(first.startDate)).toEqual([2025, 12, 24, 9, 0]);
        expect(second).toEqual(first);
    });

    it('extends only the left or right side as that edge approaches the boundary', () => {
        const bounds = range();
        const left = growTimelineRange({
            ...bounds,
            visibleStart: date(2026, 1, 2, 9),
            visibleEnd: date(2026, 1, 5, 9),
        });
        const right = growTimelineRange({
            ...bounds,
            visibleStart: date(2026, 1, 7, 9),
            visibleEnd: date(2026, 1, 10, 9),
        });

        expect(ymdh(left.startDate)).toEqual([2025, 12, 29, 9, 0]);
        expect(ymdh(left.endDate)).toEqual(ymdh(bounds.rangeEnd));
        expect(ymdh(right.startDate)).toEqual(ymdh(bounds.rangeStart));
        expect(ymdh(right.endDate)).toEqual([2026, 1, 14, 9, 0]);
    });

    it('does not change a range when the viewport is in the center', () => {
        const input = { rangeStart: date(2026, 1, 1), rangeEnd: date(2026, 6, 1), visibleStart: date(2026, 3, 1), visibleEnd: date(2026, 3, 8) };
        const grown = growTimelineRange(input);
        expect(grown).toEqual({ startDate: input.rangeStart, endDate: input.rangeEnd });
        expect(grown.startDate).not.toBe(input.rangeStart);
        expect(grown.endDate).not.toBe(input.rangeEnd);
    });

    it('never shrinks and returns unchanged cloned bounds for invalid inputs', () => {
        const bounds = range();
        const grown = growTimelineRange({ ...bounds, visibleStart: date(2026, 1, 4), visibleEnd: date(2026, 1, 6) });
        const unchanged = growTimelineRange({ ...bounds, visibleStart: null, visibleEnd: null });
        expect(grown.startDate.getTime()).toBeLessThanOrEqual(bounds.rangeStart.getTime());
        expect(grown.endDate.getTime()).toBeGreaterThanOrEqual(bounds.rangeEnd.getTime());
        expect(unchanged).toEqual({ startDate: bounds.rangeStart, endDate: bounds.rangeEnd });
        expect(unchanged.startDate).not.toBe(bounds.rangeStart);
    });

    it('returns null bounds if there are no valid range or viewport dates', () => {
        expect(growTimelineRange({ rangeStart: null, rangeEnd: new Date(NaN), visibleStart: null, visibleEnd: null }))
            .toEqual({ startDate: null, endDate: null });
    });
});

describe('includeTimelineDates', () => {
    it('unions task and milestone dates with existing range bounds', () => {
        const rangeStart = date(2026, 4, 10, 9);
        const rangeEnd = date(2026, 5, 10, 17);
        const included = includeTimelineDates({
            rangeStart,
            rangeEnd,
            taskDates: [date(2026, 3, 5, 8), date(2026, 6, 15, 18), new Date(NaN)],
        });

        expect(ymdh(included.startDate)).toEqual([2026, 3, 5, 8, 0]);
        expect(ymdh(included.endDate)).toEqual([2026, 6, 15, 18, 0]);
        expect(ymdh(rangeStart)).toEqual([2026, 4, 10, 9, 0]);
        expect(ymdh(rangeEnd)).toEqual([2026, 5, 10, 17, 0]);
    });

    it('returns null bounds when no valid dates are supplied', () => {
        expect(includeTimelineDates({ rangeStart: null, rangeEnd: new Date(NaN), taskDates: ['2026-01-01'] }))
            .toEqual({ startDate: null, endDate: null });
    });
});
