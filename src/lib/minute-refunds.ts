import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type RefundState = 'settled' | 'ready' | 'paused' | 'waiting_bono' | 'blocked' | 'awaiting_review';
export interface MinuteRefund {
    id: string;
    userId: string;
    appointmentId: string;
    sourceBonoId: string | null;
    targetBonoId: string | null;
    requestedMinutes: number;
    creditedMinutes: number;
    pendingMinutes: number;
    state: RefundState;
    reason: string | null;
    historical: boolean;
    reviewApproved: boolean;
    sourceDeleted?: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface MinuteRefundSummary { count: number; minutes: number; blocked: number; waiting: number; enabled: boolean }
export interface RefundPage { legacyItems?: MinuteRefund[]; items: MinuteRefund[]; nextCursor: string | null; summary: MinuteRefundSummary }
export const REFUND_STATE_LABELS: Record<RefundState, string> = {
    settled: 'Abonada', ready: 'Pendiente de compensación', paused: 'Compensación desactivada',
    waiting_bono: 'Esperando bono vigente', blocked: 'Inconsistencia', awaiting_review: 'Histórica: requiere auditoría',
};
export const REFUND_REASON_LABELS: Record<string, string> = {
    admin_series_schedule_reduction: 'Reducción de una serie por administración.',
    customer_series_schedule_reduction: 'Reducción de una serie por el cliente.',
    invalid_refund_accounting: 'Los importes de la devolución no son coherentes.',
    missing_source_bono: 'Falta identificar el bono del descuento original.',
    multiple_active_bonos: 'El cliente tiene varios bonos activos.', no_valid_bono: 'No existe un bono válido.',
    bono_expired: 'El bono ha caducado.', bono_not_started: 'La vigencia del bono todavía no ha comenzado.',
    invalid_bono_dates: 'Las fechas del bono no son válidas.', invalid_bono_accounting: 'Los importes del bono no son coherentes.',
    ambiguous_latest_bono: 'No se puede identificar un único bono más reciente.', bono_owner_mismatch: 'La titularidad del bono no coincide.',
    historical_review_required: 'Se conserva la deuda hasta revisar y aplicar su informe de auditoría.',
    automatic_compensation_required: 'La devolución se conserva para su compensación automática.',
};

export async function getMinuteRefundSummary(): Promise<MinuteRefundSummary> {
    return (await httpsCallable<void, MinuteRefundSummary>(functions, 'getMinuteRefundSummaryFromAdmin')()).data;
}
export async function getMinuteRefunds(filters: { state?: string; userId?: string; cursor?: string; deletedOnly?: boolean }): Promise<RefundPage> {
    return (await httpsCallable<typeof filters, RefundPage>(functions, 'getMinuteRefundsFromAdmin')(filters)).data;
}
export async function getMinuteRefundDetail(refundId: string): Promise<MinuteRefund & { movements: Record<string, unknown>[] }> {
    return (await httpsCallable<{ refundId: string }, MinuteRefund & { movements: Record<string, unknown>[] }>(functions, 'getMinuteRefundDetailFromAdmin')({ refundId })).data;
}
export async function retryMinuteRefund(refundId: string): Promise<void> {
    await httpsCallable(functions, 'retryMinuteRefundFromAdmin')({ refundId });
}

export async function auditMinuteRefunds(appointmentIds: string[]): Promise<Record<string, unknown>> {
    return (await httpsCallable<{ appointmentIds: string[] }, Record<string, unknown>>(functions, 'auditMinuteRefundsFromAdmin')({ appointmentIds })).data;
}
