'use client';

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AdminOverrideConfirmModal } from '@/components/admin/AdminOverrideConfirmModal';
import {
    type AdminOverridePrompt,
    getCallableErrorDetails,
    newAdminBookingRequestId,
    parseAdminOverridePrompt,
} from '@/lib/admin-booking-overrides';

/** One capacity change: the callable with its request id, and the fingerprint once confirmed. */
export type CapacityChangeExecutor = (input: { requestId: string; acknowledgedRestrictions?: string }) => Promise<void>;

interface PendingChange {
    prompt: AdminOverridePrompt;
    requestId: string;
    execute: CapacityChangeExecutor;
}

function errorMessage(error: unknown): string {
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message ? message : 'No se ha podido guardar el cambio. Inténtalo de nuevo.';
}

/**
 * Shared flow of every capacity change (global and per date): the server
 * checks approved seats in the same transaction and, when the new capacity is
 * below them, answers with the affected slots. The admin confirms them in the
 * same modal used for booking overrides and the request is sent again with
 * the same `requestId`. Nothing is ever cancelled or modified.
 */
export function useCapacityChangeConfirmation() {
    const [pending, setPending] = useState<PendingChange | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const pendingRef = useRef<PendingChange | null>(null);

    const show = (next: PendingChange | null) => {
        pendingRef.current = next;
        setPending(next);
    };

    /** Resolves true when saved, false when it waits for the admin's confirmation. Other errors are thrown. */
    const run = useCallback(async (execute: CapacityChangeExecutor): Promise<boolean> => {
        const requestId = newAdminBookingRequestId();
        try {
            await execute({ requestId });
            return true;
        } catch (caught) {
            const prompt = parseAdminOverridePrompt(getCallableErrorDetails(caught));
            if (!prompt) throw caught;
            setError('');
            show({ prompt, requestId, execute });
            return false;
        }
    }, []);

    const confirm = useCallback(async ({ fingerprint }: { fingerprint: string }) => {
        const current = pendingRef.current;
        if (!current) return;
        setSaving(true);
        setError('');
        try {
            await current.execute({ requestId: current.requestId, acknowledgedRestrictions: fingerprint });
            show(null);
        } catch (caught) {
            const prompt = parseAdminOverridePrompt(getCallableErrorDetails(caught));
            if (prompt) show({ ...current, prompt });
            else setError(errorMessage(caught));
        } finally {
            setSaving(false);
        }
    }, []);

    const cancel = useCallback(() => {
        if (saving) return;
        setError('');
        show(null);
    }, [saving]);

    const modal = (
        <AnimatePresence>
            {pending && (
                <AdminOverrideConfirmModal
                    prompt={pending.prompt}
                    isSeries={false}
                    mode="capacity"
                    saving={saving}
                    error={error}
                    onConfirm={confirm}
                    onCancel={cancel}
                />
            )}
        </AnimatePresence>
    );

    return { run, modal, waiting: Boolean(pending) };
}
