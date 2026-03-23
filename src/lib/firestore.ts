import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    Timestamp,
    increment,
    runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
    UserProfile,
    Service,
    Appointment,
    Testimonial,
    CMSContent,
    SandraData,
    CentroData,
    TimeSlot,
    BlockedSlot,
    SlotOccupancy,
    Trainer,
    SiteConfig,
} from '@/types';

// ============================================
// USUARIOS
// ============================================

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function createUserProfile(profile: UserProfile): Promise<void> {
    await setDoc(doc(db, 'users', profile.uid), profile);
}

export async function updateUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
    await updateDoc(doc(db, 'users', uid), data);
}

export async function getUsers(): Promise<UserProfile[]> {
    const snap = await getDocs(
        query(collection(db, 'users'))
    );
    return snap.docs.map((d) => d.data() as UserProfile);
}

// ============================================
// CITAS (APPOINTMENTS)
// ============================================

export async function getAppointments(): Promise<Appointment[]> {
    const snap = await getDocs(
        query(collection(db, 'appointments'), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
}

export async function getAppointmentsByUser(uid: string): Promise<Appointment[]> {
    const snap = await getDocs(
        query(
            collection(db, 'appointments'),
            where('userId', '==', uid),
            orderBy('createdAt', 'desc')
        )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
}

export async function addAppointment(
    data: Omit<Appointment, 'id' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<string> {
    const docRef = await addDoc(collection(db, 'appointments'), {
        ...data,
        status: 'pending',
        createdAt: new Date().toISOString(),
    });
    return docRef.id;
}

export async function updateAppointmentStatus(
    id: string,
    status: Appointment['status'],
    extraFields?: { assignedTrainer?: string; sessionType?: string; approvedSlot?: TimeSlot }
): Promise<void> {
    const update: Record<string, unknown> = {
        status,
        updatedAt: new Date().toISOString(),
    };
    if (extraFields?.assignedTrainer) update.assignedTrainer = extraFields.assignedTrainer;
    if (extraFields?.sessionType) update.sessionType = extraFields.sessionType;
    if (extraFields?.approvedSlot) update.approvedSlot = extraFields.approvedSlot;
    await updateDoc(doc(db, 'appointments', id), update);
}

export async function deleteAppointment(id: string): Promise<void> {
    await deleteDoc(doc(db, 'appointments', id));
}

/**
 * Modifica directamente la franja de una cita.
 * - Si pending: reemplaza preferredSlots con la nueva franja.
 * - Si approved: reemplaza approvedSlot con la nueva franja.
 */
export async function updateAppointmentSlot(
    id: string,
    status: Appointment['status'],
    newSlot: TimeSlot
): Promise<void> {
    const update: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
    };
    if (status === 'approved') {
        update.approvedSlot = newSlot;
    } else {
        // pending or rejected: rewrite preferredSlots
        update.preferredSlots = [newSlot];
    }
    await updateDoc(doc(db, 'appointments', id), update);
}

// ============================================
// SERVICIOS
// ============================================

export async function getServices(): Promise<Service[]> {
    const snap = await getDocs(
        query(collection(db, 'services'), orderBy('order', 'asc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Service));
}

export async function addService(data: Omit<Service, 'id'>): Promise<void> {
    await addDoc(collection(db, 'services'), data);
}

export async function updateService(id: string, data: Partial<Service>): Promise<void> {
    await updateDoc(doc(db, 'services', id), data);
}

export async function deleteService(id: string): Promise<void> {
    await deleteDoc(doc(db, 'services', id));
}

// ============================================
// TESTIMONIOS
// ============================================

export async function getTestimonials(): Promise<Testimonial[]> {
    const snap = await getDocs(collection(db, 'testimonials'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Testimonial));
}

export async function getApprovedTestimonials(): Promise<Testimonial[]> {
    const snap = await getDocs(
        query(collection(db, 'testimonials'), where('approved', '==', true))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Testimonial));
}

export async function addTestimonial(
    data: Omit<Testimonial, 'id' | 'approved'>
): Promise<void> {
    await addDoc(collection(db, 'testimonials'), { ...data, approved: false });
}

export async function updateTestimonial(
    id: string,
    data: Partial<Testimonial>
): Promise<void> {
    await updateDoc(doc(db, 'testimonials', id), data);
}

export async function deleteTestimonial(id: string): Promise<void> {
    await deleteDoc(doc(db, 'testimonials', id));
}

export async function approveTestimonial(id: string): Promise<void> {
    await updateDoc(doc(db, 'testimonials', id), { approved: true });
}

// ============================================
// CMS / CONTENIDO DEL SITIO
// ============================================

const SITE_CONTENT_DOC = 'main';

export async function getSiteContent(): Promise<CMSContent | null> {
    const snap = await getDoc(doc(db, 'site_content', SITE_CONTENT_DOC));
    return snap.exists() ? (snap.data() as CMSContent) : null;
}

export async function updateSiteContent(data: Partial<CMSContent>): Promise<void> {
    await updateDoc(doc(db, 'site_content', SITE_CONTENT_DOC), data);
}

export async function updateSandraData(data: Partial<SandraData>): Promise<void> {
    const current = await getSiteContent();
    if (!current) return;
    await updateDoc(doc(db, 'site_content', SITE_CONTENT_DOC), {
        sandra: { ...current.sandra, ...data },
    });
}

export async function updateCentroData(data: Partial<CentroData>): Promise<void> {
    const current = await getSiteContent();
    if (!current) return;
    await updateDoc(doc(db, 'site_content', SITE_CONTENT_DOC), {
        centro: { ...current.centro, ...data },
    });
}

// ============================================
// FRANJAS BLOQUEADAS (BLOCKED SLOTS)
// ============================================

export async function getBlockedSlots(): Promise<BlockedSlot[]> {
    const snap = await getDocs(
        query(collection(db, 'blocked_slots'), orderBy('date', 'asc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BlockedSlot));
}

export async function getBlockedSlotsForMonth(year: number, month: number): Promise<BlockedSlot[]> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

    const snap = await getDocs(
        query(
            collection(db, 'blocked_slots'),
            where('date', '>=', startDate),
            where('date', '<', endDate),
            orderBy('date', 'asc')
        )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BlockedSlot));
}

export async function addBlockedSlot(
    data: Omit<BlockedSlot, 'id' | 'createdAt'>
): Promise<string> {
    // Filter out undefined values — Firestore rejects them
    const cleanData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
    );
    const docRef = await addDoc(collection(db, 'blocked_slots'), {
        ...cleanData,
        createdAt: new Date().toISOString(),
    });
    return docRef.id;
}

export async function deleteBlockedSlot(id: string): Promise<void> {
    await deleteDoc(doc(db, 'blocked_slots', id));
}

// ============================================
// AFORO — Colección slot_occupancy (pública para lectura)
// ============================================

/**
 * Genera el ID del documento de slot_occupancy: "YYYY-MM-DD_HH:00"
 */
function slotOccupancyId(date: string, time: string): string {
    return `${date}_${time}`;
}

/**
 * Incrementa el contador de ocupación de una franja horaria.
 * Llamar cuando Sandra aprueba una cita.
 */
export async function incrementSlotOccupancy(date: string, time: string): Promise<void> {
    const id = slotOccupancyId(date, time);
    const ref = doc(db, 'slot_occupancy', id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
        await updateDoc(ref, { count: increment(1) });
    } else {
        await setDoc(ref, { date, time, count: 1 });
    }
}

/**
 * Decrementa el contador de ocupación de una franja horaria.
 * Llamar cuando Sandra revierte una cita aprobada a pendiente/rechazada.
 * Nunca deja el contador por debajo de 0.
 */
export async function decrementSlotOccupancy(date: string, time: string): Promise<void> {
    const id = slotOccupancyId(date, time);
    const ref = doc(db, 'slot_occupancy', id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
        const current = (snap.data() as SlotOccupancy).count;
        if (current <= 1) {
            await deleteDoc(ref);
        } else {
            await updateDoc(ref, { count: increment(-1) });
        }
    }
}

/**
 * Devuelve un mapa con la cantidad de personas aprobadas por franja horaria
 * para un mes dado. Clave: "YYYY-MM-DD_HH:00", valor: count.
 * Lee de la colección slot_occupancy (accesible para cualquier usuario autenticado).
 */
export async function getSlotOccupancyForMonth(
    year: number,
    month: number
): Promise<Record<string, number>> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

    const snap = await getDocs(
        query(
            collection(db, 'slot_occupancy'),
            where('date', '>=', startDate),
            where('date', '<', endDate)
        )
    );

    const occupancy: Record<string, number> = {};
    snap.docs.forEach((d) => {
        const data = d.data() as SlotOccupancy;
        const key = `${data.date}_${data.time}`;
        occupancy[key] = data.count;
    });

    return occupancy;
}

/**
 * Obtiene disponibilidad completa para un mes:
 * - occupancy: mapa de franjas con cantidad de personas aprobadas
 * - blockedSlots: lista de franjas bloqueadas por la admin
 */
export async function getMonthAvailability(year: number, month: number): Promise<{
    occupancy: Record<string, number>;
    blockedSlots: BlockedSlot[];
}> {
    const [occupancy, blockedSlots] = await Promise.all([
        getSlotOccupancyForMonth(year, month),
        getBlockedSlotsForMonth(year, month),
    ]);
    return { occupancy, blockedSlots };
}

// ============================================
// ENTRENADORES (TRAINERS)
// ============================================

export async function getTrainers(): Promise<Trainer[]> {
    const snap = await getDocs(collection(db, 'trainers'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Trainer));
}

export async function getActiveTrainers(): Promise<Trainer[]> {
    const snap = await getDocs(
        query(collection(db, 'trainers'), where('active', '==', true))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Trainer));
}

export async function addTrainer(data: Omit<Trainer, 'id' | 'createdAt'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'trainers'), {
        ...data,
        createdAt: new Date().toISOString(),
    });
    return docRef.id;
}

export async function deleteTrainer(id: string): Promise<void> {
    await deleteDoc(doc(db, 'trainers', id));
}

export async function getTrainerByUid(uid: string): Promise<Trainer | null> {
    const snap = await getDocs(
        query(collection(db, 'trainers'), where('uid', '==', uid))
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as Trainer;
}

export async function getAppointmentsByTrainer(trainerId: string): Promise<Appointment[]> {
    const snap = await getDocs(
        query(
            collection(db, 'appointments'),
            where('assignedTrainer', '==', trainerId),
            where('status', '==', 'approved'),
            orderBy('createdAt', 'desc')
        )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
}

export async function updateTrainerNotes(appointmentId: string, trainerNotes: string): Promise<void> {
    await updateDoc(doc(db, 'appointments', appointmentId), {
        trainerNotes,
        updatedAt: new Date().toISOString(),
    });
}

// ============================================
// ACTIVITY LOGS (TRAZABILIDAD)
// ============================================

export interface ActivityLog {
    action: string;
    adminEmail: string;
    details?: string;
    timestamp: string;
}

export async function addActivityLog(log: Omit<ActivityLog, 'timestamp'>): Promise<void> {
    await addDoc(collection(db, 'activity_logs'), {
        ...log,
        timestamp: new Date().toISOString(),
    });
}

// ============================================
// CONFIGURACIÓN GLOBAL DEL SITIO
// ============================================

const DEFAULT_SITE_CONFIG: SiteConfig = {
    startHour: 8,
    endHour: 20,
    sessionDuration: 60,
};

/**
 * Genera un array de franjas horarias a partir de la configuración.
 * Ej: { startHour: 8, endHour: 20, sessionDuration: 60 } → ['08:00', '09:00', ..., '20:00']
 */
export function generateTimeSlots(config: SiteConfig): string[] {
    const slots: string[] = [];
    const startMinutes = config.startHour * 60;
    const endMinutes = config.endHour * 60;
    for (let m = startMinutes; m <= endMinutes; m += config.sessionDuration) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }
    return slots;
}

export async function getSiteConfig(): Promise<SiteConfig> {
    const snap = await getDoc(doc(db, 'site_config', 'main'));
    if (!snap.exists()) return { ...DEFAULT_SITE_CONFIG };
    return { ...DEFAULT_SITE_CONFIG, ...snap.data() } as SiteConfig;
}

export async function updateSiteConfig(data: Partial<SiteConfig>): Promise<void> {
    await setDoc(doc(db, 'site_config', 'main'), data, { merge: true });
}
