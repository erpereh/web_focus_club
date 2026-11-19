// Upgrade legacy test fixtures to the new invariant. Existing numeric counts
// represented approved seats; pending seats must be present before any action.
// Corrupt counts are deliberately preserved so refusal tests stay meaningful.
const { getAppointmentEffectiveSlot, getCanonicalSlotBlocks } = require('../../lib/appointmentLifecycle.js');
function withPendingOccupancy(input = {}) {
  if (!input || typeof input !== 'object' || input instanceof Map) return input;
  const result = { ...input };
  for (const [path, appointment] of Object.entries(input)) {
    if (!/^appointments\/[^/]+$/.test(path) || appointment?.status !== 'pending') continue;
    const slot = getAppointmentEffectiveSlot(appointment), duration = Number(appointment.duration);
    if (!slot || ![30,45,60].includes(duration)) continue;
    for (const time of getCanonicalSlotBlocks(slot.time, duration)) {
      const key = `slot_occupancy/${slot.date}_${time}`, before = result[key];
      if (before && (!Number.isSafeInteger(before.count) || before.count < 0)) continue;
      result[key] = { ...before, date: slot.date, time, count: (before?.count ?? 0) + 1 };
    }
  }
  return result;
}
module.exports = { withPendingOccupancy };
