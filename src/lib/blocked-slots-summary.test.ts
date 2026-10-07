import { describe, expect, it } from 'vitest';
import { countUpcomingBlockedSlots, splitBlockedDaysByToday } from './blocked-slots-summary';

describe('blocked slots summary', () => {
    const today = '2026-10-07';

    it('counts only blocks from today onwards', () => {
        const slots = [
            { date: '2025-01-01' },
            { date: '2026-10-06' },
            { date: '2026-10-07' },
            { date: '2026-12-31' },
        ];
        expect(countUpcomingBlockedSlots(slots, today)).toBe(2);
        expect(countUpcomingBlockedSlots([], today)).toBe(0);
    });

    it('splits days into upcoming ascending and past most-recent first', () => {
        const result = splitBlockedDaysByToday(
            ['2026-10-09', '2026-01-01', '2026-10-07', '2026-10-06', '2026-10-09'],
            today,
        );
        expect(result.upcoming).toEqual(['2026-10-07', '2026-10-09']);
        expect(result.past).toEqual(['2026-10-06', '2026-01-01']);
    });
});
