import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/app/admin/page.tsx'), 'utf8');

describe('Admin recurring series actions', () => {
  it('offers modifying a pending recurring series through the shared modal', () => {
    const pendingActions = source.slice(
      source.indexOf("appointment.status === 'pending' && appointment.recurrenceSeriesId"),
      source.indexOf("appointment.status === 'pending' && !appointment.recurrenceSeriesId"),
    );
    expect(pendingActions).toContain('Aprobar serie');
    expect(pendingActions).toContain('Modificar');
    expect(pendingActions).toContain('Rechazar serie');
    expect(pendingActions).toContain('setShowEditSlotModal(true)');
  });

  it('confirms the authoritative approved-to-pending series action and blocks duplicate submission', () => {
    const approvedActions = source.slice(
      source.indexOf("appointment.status === 'approved' && appointment.recurrenceSeriesId"),
      source.indexOf("appointment.status === 'approved' && !appointment.recurrenceSeriesId"),
    );
    expect(approvedActions).toContain('Poner serie pendiente');
    expect(source).toContain('Se liberarán las plazas reservadas, pero los minutos seguirán reservados.');
    expect(source).toContain('returnRecurringSeriesToPendingFromAdminFS(seriesReturnPendingId)');
    expect(source).toContain("seriesActionBusy ? 'Guardando...' : 'Poner serie pendiente'");
  });
});
