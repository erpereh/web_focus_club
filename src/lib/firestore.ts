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
    writeBatch,
    arrayUnion,
    arrayRemove,
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
    GaleriaContent,
    TimeSlot,
    BlockedSlot,
    SlotOccupancy,
    Trainer,
    SiteConfig,
    Bono,
    BonoHistorialEntry,
    MediaFolder,
    MediaFile,
    GalleryItem,
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

export async function updateGaleriaData(data: GaleriaContent): Promise<void> {
    await updateDoc(doc(db, 'site_content', SITE_CONTENT_DOC), { galeria: data });
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
 * Genera el ID del documento de slot_occupancy: "YYYY-MM-DD_HH:MM"
 */
function slotOccupancyId(date: string, time: string): string {
    return `${date}_${time}`;
}

/**
 * Devuelve los bloques de 30 min que cubre una sesión.
 * Ej: startTime="09:00", durationMinutes=60 → ["09:00", "09:30"]
 *     startTime="09:00", durationMinutes=45 → ["09:00", "09:30"]
 *     startTime="09:00", durationMinutes=30 → ["09:00"]
 */
function getSlotBlocks(startTime: string, durationMinutes: number): string[] {
    const [h, m] = startTime.split(':').map(Number);
    const startTotal = h * 60 + m;
    const numBlocks = Math.ceil(durationMinutes / 30);
    return Array.from({ length: numBlocks }, (_, i) => {
        const total = startTotal + i * 30;
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    });
}

async function incrementSingleSlot(date: string, time: string): Promise<void> {
    const ref = doc(db, 'slot_occupancy', slotOccupancyId(date, time));
    const snap = await getDoc(ref);
    if (snap.exists()) {
        await updateDoc(ref, { count: increment(1) });
    } else {
        await setDoc(ref, { date, time, count: 1 });
    }
}

async function decrementSingleSlot(date: string, time: string): Promise<void> {
    const ref = doc(db, 'slot_occupancy', slotOccupancyId(date, time));
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
 * Incrementa el contador de ocupación de todos los bloques de 30 min cubiertos por la sesión.
 * Una sesión de 60 min a las 09:00 incrementa 09:00 Y 09:30.
 * Llamar cuando se aprueba una cita.
 */
export async function incrementSlotOccupancy(date: string, startTime: string, durationMinutes: number): Promise<void> {
    const blocks = getSlotBlocks(startTime, durationMinutes);
    await Promise.all(blocks.map((time) => incrementSingleSlot(date, time)));
}

/**
 * Decrementa el contador de ocupación de todos los bloques de 30 min cubiertos por la sesión.
 * Llamar cuando se revierte una cita aprobada.
 */
export async function decrementSlotOccupancy(date: string, startTime: string, durationMinutes: number): Promise<void> {
    const blocks = getSlotBlocks(startTime, durationMinutes);
    await Promise.all(blocks.map((time) => decrementSingleSlot(date, time)));
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
    slotInterval: 30,
    bonoExpirationMonths: 1,
};

/**
 * Genera un array de franjas horarias a partir de la configuración.
 * Ej: { startHour: 8, endHour: 20, slotInterval: 30 } → ['08:00', '08:30', '09:00', ..., '20:00']
 */
export function generateTimeSlots(config: SiteConfig): string[] {
    const interval = config.slotInterval ?? config.sessionDuration ?? 30;
    const slots: string[] = [];
    const startMinutes = config.startHour * 60;
    const endMinutes = config.endHour * 60;
    for (let m = startMinutes; m <= endMinutes; m += interval) {
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

// ============================================
// BONOS
// ============================================

/** Todos los bonos de un usuario, ordenados por fecha de creación descendente */
export async function getBonosByUser(userId: string): Promise<Bono[]> {
    const snap = await getDocs(
        query(collection(db, 'bonos'), where('userId', '==', userId), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bono));
}

/** Bono activo de un usuario (null si no tiene) */
export async function getActiveBonoByUser(userId: string): Promise<Bono | null> {
    const snap = await getDocs(
        query(collection(db, 'bonos'), where('userId', '==', userId), where('estado', '==', 'activo'))
    );
    return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as Bono);
}

/** Todos los bonos activos (para recalcular expiración masiva) */
export async function getAllActiveBonos(): Promise<Bono[]> {
    const snap = await getDocs(
        query(collection(db, 'bonos'), where('estado', '==', 'activo'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bono));
}

/** Asignar un nuevo bono */
export async function assignBono(data: Omit<Bono, 'id' | 'createdAt'>): Promise<string> {
    const docRef = await addDoc(collection(db, 'bonos'), {
        ...data,
        createdAt: new Date().toISOString(),
    });
    return docRef.id;
}

/** Marcar un bono como agotado (cuando se reemplaza por uno nuevo) */
export async function deactivateBono(bonoId: string): Promise<void> {
    await updateDoc(doc(db, 'bonos', bonoId), { estado: 'agotado' });
}

/** Marcar un bono como eliminado (preserva historial) */
export async function deleteBono(bonoId: string): Promise<void> {
    await updateDoc(doc(db, 'bonos', bonoId), { estado: 'eliminado' });
}

/** Añade minutos al bono; si estaba agotado, lo reactiva */
export async function addBonoMinutes(bonoId: string, minutes: number): Promise<void> {
    await runTransaction(db, async (transaction) => {
        const bonoRef = doc(db, 'bonos', bonoId);
        const snap = await transaction.get(bonoRef);
        if (!snap.exists()) throw new Error('Bono no encontrado');
        const bono = snap.data() as Omit<Bono, 'id'>;
        const newRemaining = (bono.minutosRestantes ?? 0) + minutes;
        transaction.update(bonoRef, {
            minutosRestantes: newRemaining,
            minutosTotales: (bono.minutosTotales ?? 0) + minutes,
            estado: bono.estado === 'agotado' ? 'activo' : bono.estado,
        });
    });
}

/** Descontar minutos del bono (transacción atómica) */
export async function deductBonoMinutes(bonoId: string, minutesToDeduct: number, entry: BonoHistorialEntry): Promise<void> {
    await runTransaction(db, async (transaction) => {
        const bonoRef = doc(db, 'bonos', bonoId);
        const bonoSnap = await transaction.get(bonoRef);
        if (!bonoSnap.exists()) throw new Error('Bono no encontrado');

        const bono = bonoSnap.data() as Omit<Bono, 'id'>;
        const newRemaining = (bono.minutosRestantes ?? 0) - minutesToDeduct;

        transaction.update(bonoRef, {
            minutosRestantes: newRemaining,
            estado: newRemaining <= 0 ? 'agotado' : 'activo',
            historial: arrayUnion(entry),
        });
    });
}

/** Devolver minutos al bono cuando se cancela/revierte una cita */
export async function returnBonoMinutes(bonoId: string, appointmentId: string): Promise<void> {
    await runTransaction(db, async (transaction) => {
        const bonoRef = doc(db, 'bonos', bonoId);
        const bonoSnap = await transaction.get(bonoRef);
        if (!bonoSnap.exists()) throw new Error('Bono no encontrado');

        const bono = bonoSnap.data() as Omit<Bono, 'id'>;

        // No devolver minutos si el bono está expirado
        if (bono.estado === 'expirado') return;

        const entryToRemove = bono.historial.find((h) => h.appointmentId === appointmentId);
        if (!entryToRemove) return;

        const minutesReturned = parseInt(entryToRemove.duracion, 10);
        if (isNaN(minutesReturned)) return; // entrada legacy sin duración válida

        const newRemaining = (bono.minutosRestantes ?? 0) + minutesReturned;

        transaction.update(bonoRef, {
            minutosRestantes: newRemaining,
            estado: newRemaining > 0 ? 'activo' : bono.estado,
            historial: arrayRemove(entryToRemove),
        });
    });
}

/** Deducción manual de minutos por parte del admin */
export async function manualDeductBonoMinutes(bonoId: string, minutes: number, adminEmail: string): Promise<void> {
    const entry: BonoHistorialEntry = {
        fecha: new Date().toISOString(),
        tipo: 'Deducción manual',
        duracion: String(minutes),
        appointmentId: 'manual',
    };
    await deductBonoMinutes(bonoId, minutes, entry);
}

/** Recalcular la fecha de expiración de todos los bonos activos */
export async function recalculateAllBonoExpirations(newMonths: number): Promise<void> {
    const activeBonos = await getAllActiveBonos();
    if (activeBonos.length === 0) return;

    const batch = writeBatch(db);
    const today = new Date();

    for (const bono of activeBonos) {
        const assignDate = new Date(bono.fechaAsignacion);
        const newExpiration = new Date(assignDate);
        newExpiration.setMonth(newExpiration.getMonth() + newMonths);

        const newEstado = newExpiration < today ? 'expirado' : 'activo';

        batch.update(doc(db, 'bonos', bono.id), {
            fechaExpiracion: newExpiration.toISOString(),
            estado: newEstado,
        });
    }

    await batch.commit();
}

/** Expirar bonos cuya fecha de expiración ya pasó */
export async function expireOverdueBonos(): Promise<void> {
    const activeBonos = await getAllActiveBonos();
    const now = new Date();
    const overdue = activeBonos.filter((b) => new Date(b.fechaExpiracion) < now);

    if (overdue.length === 0) return;

    const batch = writeBatch(db);
    for (const bono of overdue) {
        batch.update(doc(db, 'bonos', bono.id), { estado: 'expirado' });
    }
    await batch.commit();
}

// ============================================
// MEDIA FOLDERS
// ============================================

export async function getMediaFolders(): Promise<MediaFolder[]> {
    const snap = await getDocs(query(collection(db, 'media_folders'), orderBy('createdAt', 'asc')));
    return snap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            name: data.name,
            parentId: data.parentId ?? null,
            createdAt: data.createdAt?.toDate?.().toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
        };
    });
}

export async function createMediaFolder(name: string, parentId: string | null): Promise<string> {
    const ref = await addDoc(collection(db, 'media_folders'), {
        name,
        parentId,
        createdAt: Timestamp.now(),
    });
    return ref.id;
}

export async function renameMediaFolder(id: string, name: string): Promise<void> {
    await updateDoc(doc(db, 'media_folders', id), { name });
}

export async function deleteMediaFolder(id: string): Promise<void> {
    await deleteDoc(doc(db, 'media_folders', id));
}

// ============================================
// MEDIA FILES
// ============================================

export async function getMediaFiles(folderId: string | null): Promise<MediaFile[]> {
    const snap = await getDocs(
        query(
            collection(db, 'media_files'),
            where('folderId', '==', folderId),
            orderBy('createdAt', 'desc')
        )
    );
    return snap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            name: data.name,
            url: data.url,
            storagePath: data.storagePath,
            folderId: data.folderId ?? null,
            type: data.type,
            size: data.size,
            createdAt: data.createdAt?.toDate?.().toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
        };
    });
}

export async function getAllMediaFiles(): Promise<MediaFile[]> {
    const snap = await getDocs(
        query(collection(db, 'media_files'), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            name: data.name,
            url: data.url,
            storagePath: data.storagePath,
            folderId: data.folderId ?? null,
            type: data.type,
            size: data.size,
            createdAt: data.createdAt?.toDate?.().toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
        };
    });
}

export async function addMediaFile(data: Omit<MediaFile, 'id'>): Promise<string> {
    const ref = await addDoc(collection(db, 'media_files'), {
        ...data,
        createdAt: Timestamp.now(),
    });
    return ref.id;
}

export async function updateMediaFile(id: string, data: Partial<MediaFile>): Promise<void> {
    await updateDoc(doc(db, 'media_files', id), data);
}

export async function deleteMediaFileRecord(id: string): Promise<void> {
    await deleteDoc(doc(db, 'media_files', id));
}

// ============================================
// GALLERY ITEMS
// ============================================

function mapGalleryItem(d: { id: string; data: () => Record<string, unknown> }): GalleryItem {
    const data = d.data();
    return {
        id: d.id,
        mediaFileId: data.mediaFileId as string,
        url: data.url as string,
        type: data.type as 'image' | 'video',
        title: (data.title as string) ?? '',
        order: (data.order as number) ?? 0,
        active: (data.active as boolean) ?? true,
        createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.().toISOString?.() ?? (data.createdAt as string) ?? new Date().toISOString(),
    };
}

export async function getGalleryItems(onlyActive = false): Promise<GalleryItem[]> {
    const constraints = onlyActive
        ? [where('active', '==', true), orderBy('order', 'asc')]
        : [orderBy('order', 'asc')];
    const snap = await getDocs(query(collection(db, 'gallery_items'), ...constraints));
    return snap.docs.map(mapGalleryItem);
}

export async function addGalleryItem(data: Omit<GalleryItem, 'id'>): Promise<string> {
    const ref = await addDoc(collection(db, 'gallery_items'), {
        ...data,
        createdAt: Timestamp.now(),
    });
    return ref.id;
}

export async function updateGalleryItem(id: string, data: Partial<Omit<GalleryItem, 'id'>>): Promise<void> {
    await updateDoc(doc(db, 'gallery_items', id), data);
}

export async function deleteGalleryItem(id: string): Promise<void> {
    await deleteDoc(doc(db, 'gallery_items', id));
}

export async function reorderGalleryItems(items: { id: string; order: number }[]): Promise<void> {
    const batch = writeBatch(db);
    for (const { id, order } of items) {
        batch.update(doc(db, 'gallery_items', id), { order });
    }
    await batch.commit();
}

export async function getActiveGalleryItemsByDate(): Promise<GalleryItem[]> {
    const snap = await getDocs(
        query(collection(db, 'gallery_items'), where('active', '==', true))
    );
    return snap.docs
        .map(mapGalleryItem)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ============================================
// SYSTEM CONFIG
// ============================================

export async function getOrCreateGalleryFolder(): Promise<{ folderId: string }> {
    const configRef = doc(db, 'system_config', 'gallery_folder');
    const configSnap = await getDoc(configRef);
    if (configSnap.exists()) {
        return { folderId: configSnap.data().folderId as string };
    }
    // Create the media folder doc
    const folderRef = await addDoc(collection(db, 'media_folders'), {
        name: 'Galería Pública',
        parentId: null,
        createdAt: Timestamp.now(),
    });
    // Store the reference in system_config
    await setDoc(configRef, { folderId: folderRef.id });
    return { folderId: folderRef.id };
}
