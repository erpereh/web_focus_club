#!/usr/bin/env node

const admin = require("firebase-admin");

const execute = process.argv.includes("--execute");
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "focus-club-f73b8";
const activeStatuses = ["pending", "approved", "pendiente", "aprobada"];

if (execute) {
  console.error("Backfill con --execute no esta implementado para evitar escrituras accidentales.");
  console.error("Usa este script sin --execute para listar citas activas sin googleCalendarEventId.");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

function formatAppointment(doc) {
  const data = doc.data();
  const slot = data.approvedSlot || data.preferredSlots?.[0] || {};
  return {
    id: doc.id,
    status: data.status || "",
    client: data.name || data.email || data.userId || "Cliente",
    serviceType: data.serviceType || "",
    date: slot.date || data.date || "",
    time: slot.time || data.time || "",
    duration: data.duration || "",
  };
}

async function main() {
  const db = admin.firestore();
  const snap = await db.collection("appointments")
    .where("status", "in", activeStatuses)
    .get();

  const missingCalendarEvent = snap.docs
    .filter((doc) => !doc.data().googleCalendarEventId)
    .map(formatAppointment);

  console.log(`Proyecto: ${projectId}`);
  console.log(`Citas activas sin googleCalendarEventId: ${missingCalendarEvent.length}`);
  console.table(missingCalendarEvent);
  console.log("Dry-run: no se ha escrito ningun dato.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
