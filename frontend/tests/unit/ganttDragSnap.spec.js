import { describe, expect, it } from 'vitest';
import { snapDragDates } from '@/views/Projects/GanttView/dragSnap';
import { datesForGanttDrag } from '@/views/Projects/GanttView/dragDates';

const DAY_MS = 24 * 60 * 60 * 1000;
const dragModes = { move: 'move', resize: 'resize' };
const at = (day, hour = 0, minute = 0, second = 0, ms = 0) => new Date(2026, 8, day, hour, minute, second, ms);
const plusDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

describe('snapDragDates', () => {
    describe('move', () => {
        it('keeps the bar in place when the drag covers less than half a day', () => {
            const original = { start_date: at(5, 9), end_date: at(9, 17) };
            const dragged = { start_date: plusDays(original.start_date, 0.4), end_date: plusDays(original.end_date, 0.4) };

            const result = snapDragDates({ mode: 'move', dragModes, original, dragged });

            expect(result.start_date).toEqual(at(5, 9));
            expect(result.end_date).toEqual(at(9, 17));
        });

        it('shifts the bar by one whole day when the drag covers more than half a day', () => {
            const original = { start_date: at(5, 9), end_date: at(9, 17) };
            const dragged = { start_date: plusDays(original.start_date, 0.6), end_date: plusDays(original.end_date, 0.6) };

            const result = snapDragDates({ mode: 'move', dragModes, original, dragged });

            expect(result.start_date).toEqual(at(6, 9));
            expect(result.end_date).toEqual(at(10, 17));
        });

        it('shifts both ends back by the same whole-day count for a negative move', () => {
            const original = { start_date: at(5, 9), end_date: at(9, 17) };
            const dragged = { start_date: plusDays(original.start_date, -2.1), end_date: plusDays(original.end_date, -2.1) };

            const result = snapDragDates({ mode: 'move', dragModes, original, dragged });

            expect(result.start_date).toEqual(at(3, 9));
            expect(result.end_date).toEqual(at(7, 17));
        });

        it('keeps a non-midnight start time of day after a move', () => {
            const original = { start_date: at(5, 13, 45), end_date: at(9, 16, 20) };
            const dragged = { start_date: at(8, 13, 45), end_date: at(12, 16, 20) };

            const result = snapDragDates({ mode: 'move', dragModes, original, dragged });

            expect(result.start_date).toEqual(at(8, 13, 45));
            expect(result.end_date).toEqual(at(12, 16, 20));
        });
    });

    describe('resize', () => {
        it('moves only the start edge and keeps the end at its exact instant', () => {
            const originalEnd = at(9, 17, 30, 15, 250);
            const original = { start_date: at(5, 9), end_date: originalEnd };
            const dragged = { start_date: at(3, 9), end_date: originalEnd };

            const result = snapDragDates({ mode: 'resize', dragModes, original, dragged });

            expect(result.start_date).toEqual(at(3, 9));
            expect(result.end_date.getTime()).toBe(originalEnd.getTime());
        });

        it('moves only the end edge and keeps the start at its exact instant', () => {
            const originalStart = at(5, 9, 0, 30, 500);
            const original = { start_date: originalStart, end_date: at(9, 17) };
            const dragged = { start_date: originalStart, end_date: at(11, 17) };

            const result = snapDragDates({ mode: 'resize', dragModes, original, dragged });

            expect(result.start_date.getTime()).toBe(originalStart.getTime());
            expect(result.end_date).toEqual(at(11, 17));
        });

        it('leaves the edge unchanged when the resize covers less than half a day', () => {
            const originalEnd = at(9, 17);
            const original = { start_date: at(5, 9), end_date: originalEnd };
            const dragged = { start_date: at(5, 9), end_date: plusDays(originalEnd, 0.4) };

            const result = snapDragDates({ mode: 'resize', dragModes, original, dragged });

            expect(result.end_date.getTime()).toBe(originalEnd.getTime());
        });

        it('clamps a start edge dragged past the end so the bar keeps one calendar day', () => {
            const originalEnd = at(9, 17);
            const original = { start_date: at(5, 9), end_date: originalEnd };
            const dragged = { start_date: at(12, 9), end_date: originalEnd };

            const result = snapDragDates({ mode: 'resize', dragModes, original, dragged });

            expect(result.start_date).toEqual(at(8, 17));
            expect(result.end_date.getTime()).toBe(originalEnd.getTime());
        });

        it('clamps an end edge dragged before the start so the bar keeps one calendar day', () => {
            const originalStart = at(5, 9);
            const original = { start_date: originalStart, end_date: at(9, 17) };
            const dragged = { start_date: originalStart, end_date: at(3, 17) };

            const result = snapDragDates({ mode: 'resize', dragModes, original, dragged });

            expect(result.start_date.getTime()).toBe(originalStart.getTime());
            expect(result.end_date).toEqual(at(6, 9));
        });
    });

    describe('across a DST change', () => {
        const previousTz = process.env.TZ;

        it('moves by whole calendar days and keeps clock times across the spring change', () => {
            process.env.TZ = 'America/New_York';
            try {
                const original = { start_date: new Date(2026, 2, 7, 9, 15), end_date: new Date(2026, 2, 9, 17, 0) };
                const dragged = { start_date: new Date(2026, 2, 8, 9, 15), end_date: new Date(2026, 2, 10, 17, 0) };

                const result = snapDragDates({ mode: 'move', dragModes, original, dragged });

                expect(result.start_date).toEqual(new Date(2026, 2, 8, 9, 15));
                expect(result.end_date).toEqual(new Date(2026, 2, 10, 17, 0));
                expect(result.start_date.getHours()).toBe(9);
                expect(result.start_date.getMinutes()).toBe(15);
            } finally {
                if (previousTz === undefined) delete process.env.TZ;
                else process.env.TZ = previousTz;
            }
        });

        it('resizes the end edge by one whole day across the spring change', () => {
            process.env.TZ = 'America/New_York';
            try {
                const originalStart = new Date(2026, 2, 6, 8, 30);
                const original = { start_date: originalStart, end_date: new Date(2026, 2, 7, 17, 0) };
                const dragged = { start_date: originalStart, end_date: new Date(2026, 2, 8, 17, 0) };

                const result = snapDragDates({ mode: 'resize', dragModes, original, dragged });

                expect(result.start_date.getTime()).toBe(originalStart.getTime());
                expect(result.end_date).toEqual(new Date(2026, 2, 8, 17, 0));
            } finally {
                if (previousTz === undefined) delete process.env.TZ;
                else process.env.TZ = previousTz;
            }
        });
    });

    describe('passthrough', () => {
        it('returns the dragged dates as copies for a mode that is not move or resize', () => {
            const original = { start_date: at(5, 9), end_date: at(9, 17) };
            const dragged = { start_date: at(6, 9), end_date: at(10, 17) };

            const result = snapDragDates({ mode: 'progress', dragModes, original, dragged });

            expect(result).toEqual({ start_date: at(6, 9), end_date: at(10, 17) });
            expect(result.start_date).not.toBe(dragged.start_date);
            expect(result.end_date).not.toBe(dragged.end_date);
        });

        it('returns the dragged dates when the original dates are missing', () => {
            const dragged = { start_date: at(6, 9), end_date: at(10, 17) };

            const result = snapDragDates({ mode: 'move', dragModes, original: undefined, dragged });

            expect(result).toEqual({ start_date: at(6, 9), end_date: at(10, 17) });
        });

        it('returns null for a dragged date that is not a valid date', () => {
            const original = { start_date: at(5, 9), end_date: at(9, 17) };

            const result = snapDragDates({ mode: 'move', dragModes, original, dragged: { start_date: 'not a date', end_date: at(10, 17) } });

            expect(result.start_date).toBeNull();
            expect(result.end_date).toEqual(at(10, 17));
        });
    });

    describe('round trip through datesForGanttDrag', () => {
        it('shifts stored dates by the whole days the snapped drag covers', () => {
            const stored = { startDate: at(4, 8, 15), DueDate: at(6, 23, 59, 59, 987) };
            const original = { start_date: stored.startDate, end_date: stored.DueDate };
            const dragged = { start_date: plusDays(original.start_date, 2.3), end_date: plusDays(original.end_date, 2.3) };

            const snapped = snapDragDates({ mode: 'move', dragModes, original, dragged });
            const result = datesForGanttDrag({ mode: 'move', dragModes, original, dragged: snapped, stored });

            expect(result).toEqual({ startDate: at(6, 8, 15), DueDate: at(8, 23, 59, 59, 987) });
        });

        it('produces no stored change when the snapped drag covers less than half a day', () => {
            const stored = { startDate: at(4, 8, 15), DueDate: at(6, 23, 59, 59, 987) };
            const original = { start_date: stored.startDate, end_date: stored.DueDate };
            const dragged = { start_date: plusDays(original.start_date, 0.4), end_date: plusDays(original.end_date, 0.4) };

            const snapped = snapDragDates({ mode: 'move', dragModes, original, dragged });
            const result = datesForGanttDrag({ mode: 'move', dragModes, original, dragged: snapped, stored });

            expect(result).toBeNull();
        });
    });
});
