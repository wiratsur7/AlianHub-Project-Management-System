import { describe, expect, it } from 'vitest';
import { datesForGanttDrag } from '@/views/Projects/GanttView/dragDates';

const dragModes = { move: 'move', resize: 'resize' };
const localDate = (day, hour = 0, minute = 0, second = 0, ms = 0, month = 8) =>
    new Date(2026, month, day, hour, minute, second, ms);

describe('datesForGanttDrag', () => {
    it('moves a weekend interval by calendar days and preserves its duration', () => {
        const original = { start_date: localDate(4, 9), end_date: localDate(6, 17) };
        const dragged = { start_date: localDate(6, 9), end_date: localDate(8, 17) };
        const stored = { startDate: localDate(4, 9), DueDate: localDate(6, 17) };

        const result = datesForGanttDrag({ mode: 'move', dragModes, original, dragged, stored });

        expect(result).toEqual({ startDate: localDate(6, 9), DueDate: localDate(8, 17) });
        expect(result.DueDate.getTime() - result.startDate.getTime()).toBe(stored.DueDate.getTime() - stored.startDate.getTime());
    });

    it.each([
        ['midnight', localDate(4)],
        ['end of day', localDate(4, 23, 59, 59)],
    ])('preserves the stored DueDate time for a %s endpoint during a move', (_label, dueDate) => {
        const stored = { startDate: localDate(2, 8, 15), DueDate: dueDate };
        const result = datesForGanttDrag({
            mode: 'move',
            dragModes,
            original: { start_date: localDate(2, 8, 15), end_date: localDate(4) },
            dragged: { start_date: localDate(5, 8, 15), end_date: localDate(7) },
            stored,
        });

        expect(result.startDate).toEqual(localDate(5, 8, 15));
        expect(result.DueDate).toEqual(localDate(7, dueDate.getHours(), dueDate.getMinutes(), dueDate.getSeconds(), dueDate.getMilliseconds()));
    });

    it('resizes the start edge and preserves the stored due date exactly', () => {
        const dueDate = localDate(9, 23, 59, 59, 987);
        const stored = { startDate: localDate(4, 8), DueDate: dueDate };
        const result = datesForGanttDrag({
            mode: 'resize',
            dragModes,
            original: { start_date: localDate(4, 8), end_date: localDate(9) },
            dragged: { start_date: localDate(3, 8), end_date: localDate(9) },
            stored,
        });

        expect(result.startDate).toEqual(localDate(3, 8));
        expect(result.DueDate).toBe(dueDate);
    });

    it('resizes the end edge and preserves the stored start date exactly', () => {
        const startDate = localDate(4, 8, 30);
        const stored = { startDate, DueDate: localDate(9, 23, 59, 59) };
        const result = datesForGanttDrag({
            mode: 'resize',
            dragModes,
            original: { start_date: localDate(4, 8, 30), end_date: localDate(9) },
            dragged: { start_date: localDate(4, 8, 30), end_date: localDate(10) },
            stored,
        });

        expect(result.startDate).toBe(startDate);
        expect(result.DueDate).toEqual(localDate(10));
    });

    it('returns null for no-op drags and unsupported modes', () => {
        const original = { start_date: localDate(4), end_date: localDate(4) };
        const stored = { startDate: localDate(4), DueDate: localDate(4) };

        expect(datesForGanttDrag({ mode: 'move', dragModes, original, dragged: original, stored })).toBeNull();
        expect(datesForGanttDrag({ mode: 'resize', dragModes, original, dragged: original, stored })).toBeNull();
        expect(datesForGanttDrag({ mode: 'progress', dragModes, original, dragged: original, stored })).toBeNull();
    });

    it('moves equal start and due boundaries without rejecting them', () => {
        const result = datesForGanttDrag({
            mode: 'move',
            dragModes,
            original: { start_date: localDate(4), end_date: localDate(4) },
            dragged: { start_date: localDate(6), end_date: localDate(6) },
            stored: { startDate: localDate(4), DueDate: localDate(4) },
        });

        expect(result).toEqual({ startDate: localDate(6), DueDate: localDate(6) });
    });

    it('returns null when any required date is invalid', () => {
        const original = { start_date: localDate(4), end_date: localDate(6) };
        const dragged = { start_date: localDate(5), end_date: localDate(7) };
        const stored = { startDate: localDate(4), DueDate: localDate(6) };

        expect(datesForGanttDrag({ mode: 'move', dragModes, original: { ...original, start_date: 'bad' }, dragged, stored })).toBeNull();
        expect(datesForGanttDrag({ mode: 'move', dragModes, original, dragged: { ...dragged, end_date: null }, stored })).toBeNull();
        expect(datesForGanttDrag({ mode: 'move', dragModes, original, dragged, stored: { ...stored, DueDate: undefined } })).toBeNull();
    });

    it('uses local calendar-day arithmetic across the spring DST transition', () => {
        const previousTz = process.env.TZ;
        process.env.TZ = 'America/New_York';
        try {
            const stored = {
                startDate: new Date(2026, 2, 6, 9, 15),
                DueDate: new Date(2026, 2, 8, 23, 59, 59),
            };
            const result = datesForGanttDrag({
                mode: 'move',
                dragModes,
                original: { start_date: new Date(2026, 2, 7, 10), end_date: new Date(2026, 2, 8, 23, 59, 59) },
                dragged: { start_date: new Date(2026, 2, 9, 10), end_date: new Date(2026, 2, 10, 23, 59, 59) },
                stored,
            });

            expect(result.startDate).toEqual(new Date(2026, 2, 8, 9, 15));
            expect(result.DueDate).toEqual(new Date(2026, 2, 10, 23, 59, 59));
            expect(result.startDate.getHours()).toBe(9);
        } finally {
            if (previousTz === undefined) delete process.env.TZ;
            else process.env.TZ = previousTz;
        }
    });
});
