const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyAppointmentChange, isGroupedOperationWrite } = require("../lib/notifications/appointmentEvents.js");
const { bonoCivilDate, bonoExpiryInstant, classifyBonoChange } = require("../lib/notifications/bonoEvents.js");

const NOW = new Date("2026-10-01T08:00:00.000Z"); // 10:00 Madrid

function appt(overrides = {}) {
  return {
    userId: "user-1",
    name: "Lucía",
    email: "lucia@example.com",
    status: "pending",
    preferredSlots: [{ date: "2026-10-05", time: "10:00" }],
    duration: "60",
    ...overrides,
  };
}

function approved(overrides = {}) {
  return appt({
    status: "approved",
    approvedSlot: { date: "2026-10-05", time: "10:00" },
    assignedTrainer: "trainer-1",
    sessionType: "Entrenamiento",
    ...overrides,
  });
}

const eventOf = (before, after) => classifyAppointmentChange(before, after, NOW)?.event ?? null;

test("appointment creation: requested when pending, confirmed when created approved", () => {
  assert.equal(eventOf(undefined, appt()), "appointment_requested");
  assert.equal(eventOf(undefined, approved()), "appointment_confirmed");
  assert.equal(eventOf(undefined, appt({ status: "cancelled" })), null);
});

test("status transitions map to confirmed / rejected / cancelled", () => {
  assert.equal(eventOf(appt(), approved()), "appointment_confirmed");
  assert.equal(eventOf(appt(), appt({ status: "rejected" })), "appointment_rejected");
  assert.equal(eventOf(approved(), approved({ status: "cancelled" })), "appointment_cancelled");
  assert.equal(eventOf(appt(), appt({ status: "cancelled" })), "appointment_cancelled");
  const change = classifyAppointmentChange(appt(), approved(), NOW);
  assert.equal(change.status, "approved");
});

test("date, time, trainer or duration changes without status change are rescheduled", () => {
  const moved = classifyAppointmentChange(
    approved(),
    approved({ approvedSlot: { date: "2026-10-06", time: "11:15" } }),
    NOW,
  );
  assert.equal(moved.event, "appointment_rescheduled");
  assert.deepEqual(moved.previousSlot, { date: "2026-10-05", time: "10:00" });
  assert.equal(eventOf(approved(), approved({ assignedTrainer: "trainer-2" })), "appointment_rescheduled");
  assert.equal(eventOf(approved(), approved({ duration: "45" })), "appointment_rescheduled");
  assert.equal(eventOf(appt(), appt({ preferredSlots: [{ date: "2026-10-07", time: "09:00" }] })), "appointment_rescheduled");
});

test("customer reschedule of an approved appointment back to pending is rescheduled; same slot is requested", () => {
  const rescheduled = classifyAppointmentChange(
    approved(),
    appt({ preferredSlots: [{ date: "2026-10-08", time: "12:00" }] }),
    NOW,
  );
  assert.equal(rescheduled.event, "appointment_rescheduled");
  assert.equal(rescheduled.status, "pending");
  assert.equal(eventOf(approved(), appt({ assignedTrainer: "trainer-1", sessionType: "Entrenamiento" })), "appointment_requested");
});

test("technical changes do not notify", () => {
  const base = approved();
  assert.equal(eventOf(base, { ...base, googleCalendarEventId: "evt", googleCalendarSyncHash: "h" }), null);
  assert.equal(eventOf(base, { ...base, updatedAt: "x", minutesDeducted: true, trainerNotes: "notas" }), null);
});

test("past sessions and inactive deletions do not notify", () => {
  const past = approved({ approvedSlot: { date: "2026-09-01", time: "10:00" } });
  assert.equal(eventOf(past, { ...past, status: "cancelled" }), null);
  assert.equal(eventOf(past, undefined), null);
  assert.equal(eventOf(approved({ status: "cancelled" }), undefined), null);
  assert.equal(eventOf(approved(), undefined), "appointment_deleted");
  assert.equal(classifyAppointmentChange(approved(), undefined, NOW).status, "deleted");
});

test("writes stamped with a new notificationOperationId are left to the grouped notice", () => {
  const op = { notificationOperationId: "op-1" };
  assert.equal(isGroupedOperationWrite(undefined, approved(op)), true);
  assert.equal(eventOf(undefined, approved(op)), null);
  assert.equal(eventOf(appt(), approved(op)), null);
  // A later single change on the same appointment is notified again.
  assert.equal(eventOf(approved(op), approved({ ...op, status: "cancelled" })), "appointment_cancelled");
});

function bono(overrides = {}) {
  return {
    userId: "user-1",
    estado: "activo",
    tamano: 240,
    minutosTotales: 240,
    minutosRestantes: 120,
    fechaAsignacion: "2026-09-01T00:00:00.000Z",
    fechaExpiracion: "2026-12-31T22:59:59.999Z",
    ...overrides,
  };
}

const bonoEvent = (before, after, hadPreviousBono = false) =>
  classifyBonoChange(before, after, { hadPreviousBono })?.event ?? null;

test("bono creation is assigned or renewed", () => {
  assert.equal(bonoEvent(undefined, bono()), "bono_assigned");
  assert.equal(bonoEvent(undefined, bono(), true), "bono_renewed");
  assert.equal(bonoEvent(undefined, bono({ estado: "eliminado" })), null);
});

test("bono exhausted only when available minutes drop to zero", () => {
  assert.equal(bonoEvent(bono({ minutosRestantes: 60 }), bono({ minutosRestantes: 0, estado: "agotado" })), "bono_exhausted");
  // Reserved at booking: an active bono can reach 0 without changing estado.
  assert.equal(bonoEvent(bono({ minutosRestantes: 30 }), bono({ minutosRestantes: 0 })), "bono_exhausted");
  // Renewal deactivates the old bono with minutes left: not an exhaustion.
  assert.equal(bonoEvent(bono({ minutosRestantes: 120 }), bono({ minutosRestantes: 120, estado: "agotado" })), null);
  // Minutes going down but not to zero, or refunds.
  assert.equal(bonoEvent(bono({ minutosRestantes: 120 }), bono({ minutosRestantes: 60 })), null);
  assert.equal(bonoEvent(bono({ minutosRestantes: 0, estado: "agotado" }), bono({ minutosRestantes: 60 })), null);
});

test("bono expiry and validity changes", () => {
  assert.equal(bonoEvent(bono(), bono({ estado: "expirado" })), "bono_expired");
  // Expiry wins over simultaneous date recalculation.
  assert.equal(bonoEvent(bono(), bono({ estado: "expirado", fechaExpiracion: "2026-09-30T21:59:59.999Z" })), "bono_expired");
  assert.equal(bonoEvent(bono(), bono({ fechaExpiracion: "2027-01-31T22:59:59.999Z" })), "bono_validity_changed");
  assert.equal(bonoEvent(bono(), bono({ fechaAsignacion: "2026-09-02T00:00:00.000Z" })), "bono_validity_changed");
  // Same civil day in Madrid: no visible change.
  assert.equal(bonoEvent(bono(), bono({ fechaExpiracion: "2026-12-31T22:00:00.000Z" })), null);
  assert.equal(bonoEvent(bono(), bono({ estado: "eliminado" })), null);
});

test("bono civil dates and expiry instants use Europe/Madrid", () => {
  assert.equal(bonoCivilDate("2026-12-31T23:30:00.000Z"), "2027-01-01");
  assert.equal(bonoCivilDate("2026-12-31"), "2026-12-31");
  assert.equal(bonoExpiryInstant("2026-12-31").toISOString(), "2026-12-31T22:59:59.999Z");
  assert.equal(bonoExpiryInstant("2026-07-31").toISOString(), "2026-07-31T21:59:59.999Z");
});
