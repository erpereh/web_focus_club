/** Includes transport failures generated before the callable handler can run. */
export function getAdminTransportErrorMessage(error: unknown): string | undefined {
    const rawCode = (error as { code?: unknown } | null)?.code;
    if (typeof rawCode !== 'string') return undefined;
    const code = rawCode.replace(/^functions\//, '');
    const check = 'Actualiza las citas para comprobar el resultado antes de repetir la operación.';
    switch (code) {
        case 'aborted': return `Hay otra operación modificando estas citas. ${check}`;
        case 'deadline-exceeded': return `No se ha podido confirmar la operación a tiempo. ${check}`;
        case 'resource-exhausted': return `El servicio está ocupado. ${check}`;
        case 'unavailable': return `El servicio no está disponible temporalmente. ${check}`;
        case 'internal': return `No se ha podido confirmar la operación. ${check}`;
        default: return undefined;
    }
}

export function getAdminCallableErrorMessage(error: unknown, fallback: string): string {
    const transportMessage = getAdminTransportErrorMessage(error);
    if (transportMessage) return transportMessage;
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error ? error.message : '';
    if (code === 'functions/already-exists') return 'Ya existe un usuario con este email.';
    if (code === 'functions/permission-denied') return message || 'Permisos insuficientes.';
    if (code === 'functions/invalid-argument') return message || 'Revisa los campos obligatorios.';
    return message || fallback;
}
