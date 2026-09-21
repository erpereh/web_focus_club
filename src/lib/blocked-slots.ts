import type { Appointment, BlockedSlot, SlotInterval } from '@/types';
import { getCanonicalSlotBlocks, slotOccupancyKey } from './appointment-slots';

export interface BuildBlockedSlotGroupsInput {
    date: string;
    startTimes: string[];
    groupDurationMinutes: SlotInterval;
    reason?: string;
    createdBy: string;
    createdAt: string;
}

export interface BlockedSlotGroup {
    id: string;
    date: string;
    startTime: string;
    durationMinutes?: number;
    reason?: string;
    createdBy: string;
    createdAt: string;
    documentIds: string[];
}

export function canonicalBlockedSlotId(date: string, time: string): string {
    return `${date}_${time}`;
}

export function canonicalBlockGroupId(date: string, startTime: string, durationMinutes: number): string {
    return `${date}_${startTime}_${durationMinutes}`;
}

export function buildCanonicalBlockedSlotDocuments(input: BuildBlockedSlotGroupsInput): BlockedSlot[] {
    const documents = new Map<string, BlockedSlot>();
    const starts = [...new Set(input.startTimes)].sort();

    for (const startTime of starts) {
        const blockGroupId = canonicalBlockGroupId(input.date, startTime, input.groupDurationMinutes);
        for (const time of getCanonicalSlotBlocks(startTime, input.groupDurationMinutes)) {
            const id = canonicalBlockedSlotId(input.date, time);
            if (documents.has(id)) {
                throw new Error(`El bloque ${input.date} ${time} pertenece a más de una selección.`);
            }
            documents.set(id, {
                id,
                date: input.date,
                time,
                ...(input.reason ? { reason: input.reason } : {}),
                createdBy: input.createdBy,
                createdAt: input.createdAt,
                blockGroupId,
                groupStartTime: startTime,
                groupDurationMinutes: input.groupDurationMinutes,
                sourceSlotInterval: input.groupDurationMinutes,
            });
        }
    }

    return [...documents.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function groupBlockedSlots(slots: BlockedSlot[]): BlockedSlotGroup[] {
    const groups = new Map<string, BlockedSlotGroup>();
    const sorted = [...slots].sort((left, right) => `${left.date}_${left.time}_${left.id}`.localeCompare(`${right.date}_${right.time}_${right.id}`));

    for (const slot of sorted) {
        const id = slot.blockGroupId ?? `legacy:${slot.id}`;
        const existing = groups.get(id);
        if (existing) {
            existing.documentIds.push(slot.id);
            continue;
        }
        groups.set(id, {
            id,
            date: slot.date,
            startTime: slot.groupStartTime ?? slot.time,
            durationMinutes: slot.groupDurationMinutes,
            reason: slot.reason,
            createdBy: slot.createdBy,
            createdAt: slot.createdAt,
            documentIds: [slot.id],
        });
    }

    return [...groups.values()];
}

export function getBlockedSelectionKeys(
    date: string,
    startTimes: string[],
    groupDurationMinutes: SlotInterval,
): Set<string> {
    return new Set(startTimes.flatMap((startTime) => (
        getCanonicalSlotBlocks(startTime, groupDurationMinutes)
            .map((time) => slotOccupancyKey(date, time))
    )));
}

export function overlapsBlockedSelection(appointment: Appointment, blockedKeys: Set<string>): boolean {
    if (appointment.status !== 'pending' && appointment.status !== 'approved') return false;
    const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0];
    if (!slot) return false;
    return getCanonicalSlotBlocks(slot.time, Number(appointment.duration)).some((time) => (
        blockedKeys.has(slotOccupancyKey(slot.date, time))
    ));
}
