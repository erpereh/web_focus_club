// ============================================
// TIPOS COMPARTIDOS — Focus Club Vallecas
// ============================================

export interface UserProfile {
    uid: string;
    email: string;
    name: string;
    phone?: string;
    role: 'admin' | 'trainer' | 'user';
    isTrainer?: boolean;
    photoURL?: string;
    createdAt: string;
}

export interface Service {
    id: string;
    title: string;
    description: string;
    duration: string;
    price?: string;
    image?: string;
    features?: string[];
    order?: number;
    icon?: string;
}

export interface TimeSlot {
    date: string;
    time: string;
}

export interface Appointment {
    id: string;
    userId: string;
    name: string;
    email: string;
    phone: string;
    serviceType: string;
    duration: '30' | '45' | '60';
    preferredSlots: TimeSlot[];
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
    approvedSlot?: TimeSlot;
    assignedTrainer?: string;
    sessionType?: string;
    trainerNotes?: string;
    createdAt: string;
    updatedAt?: string;
}

export interface BlockedSlot {
    id: string;
    date: string;       // "YYYY-MM-DD"
    time: string;       // "HH:MM"
    reason?: string;
    createdBy: string;  // uid del admin
    createdAt: string;
}

export interface SlotOccupancy {
    date: string;       // "YYYY-MM-DD"
    time: string;       // "HH:MM" (intervalos de 30 min)
    count: number;      // número de personas aprobadas en esa franja
}

export interface Trainer {
    id: string;
    uid: string;        // referencia al uid en la colección users
    name: string;
    specialties?: string[];
    active: boolean;
    createdAt: string;
}

export interface Testimonial {
    id: string;
    name: string;
    role: string;
    content: string;
    rating: number;
    image?: string;
    approved: boolean;
}

export interface SandraData {
    name: string;
    title: string;
    subtitle: string;
    bio: string;
    experience: string;
    achievements: string[];
    certifications: string[];
    timeline: {
        year: string;
        title: string;
        description: string;
    }[];
    image: string;
}

export interface CentroData {
    title: string;
    subtitle: string;
    description: string;
    features: {
        icon: string;
        title: string;
        description: string;
    }[];
    gallery: string[];
    schedule: {
        weekdays: string;
        saturday: string;
    };
}

export interface SiteConfig {
    startHour: number;         // ej: 8
    endHour: number;           // ej: 20
    slotInterval: number;      // intervalo de slots en minutos (default: 30)
    bonoExpirationMonths: number; // meses de validez de los bonos (default: 1)
    // Legacy (compatibilidad hacia atrás)
    sessionDuration?: number;
}

// ============================================
// BONOS
// ============================================

export interface BonoHistorialEntry {
    fecha: string;          // ISO date de la sesión
    tipo: string;           // nombre del servicio o "Deducción manual"
    duracion: string;       // '30' | '45' | '60' — minutos de la sesión
    appointmentId: string;  // ref a appointments/{id} o 'manual'
}

export interface Bono {
    id: string;
    userId: string;            // ref a users/{uid}
    tamano: 240 | 360 | 480;  // tamaño del bono: 4h, 6h u 8h en minutos
    minutosTotales: number;    // minutos totales al crear el bono
    minutosRestantes: number;  // minutos disponibles
    fechaAsignacion: string;   // ISO date
    fechaExpiracion: string;   // calculada: fechaAsignacion + bonoExpirationMonths
    estado: 'activo' | 'agotado' | 'expirado' | 'eliminado';
    historial: BonoHistorialEntry[];
    asignadoPor: string;       // admin email
    createdAt: string;
    // Campos legacy (solo lectura, para bonos creados antes de la migración)
    tipo?: string;
    sesionesTotales?: number;
    sesionesRestantes?: number;
    modalidad?: string;
}

/** Devuelve los minutos restantes del bono, con soporte para bonos legacy. */
export function getBonoMinutosRestantes(bono: Bono): number {
    if (bono.minutosRestantes !== undefined) return bono.minutosRestantes;
    const minPerSession = bono.modalidad === '30min' ? 30 : 60;
    return (bono.sesionesRestantes ?? 0) * minPerSession;
}

/** Devuelve los minutos totales del bono, con soporte para bonos legacy. */
export function getBonoMinutosTotales(bono: Bono): number {
    if (bono.minutosTotales !== undefined) return bono.minutosTotales;
    const minPerSession = bono.modalidad === '30min' ? 30 : 60;
    return (bono.sesionesTotales ?? 0) * minPerSession;
}

/** Formatea minutos como string legible: "4h", "3h 30min", "30min" */
export function formatMinutos(minutos: number): string {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
}

export interface GaleriaContent {
    heroTitle: string;
    heroSubtitle: string;
    stats: { value: number; suffix: string; label: string }[];
    transformaciones: { name: string; periodo: string; resultado: string }[];
    resultados: { name: string; stat: string; statLabel: string; tag: string; story: string; detail: string }[];
}

export interface CMSContent {
    heroTitle: string;
    heroSubtitle: string;
    heroCTA: string;
    heroImage: string;

    aboutTitle: string;
    aboutText: string;
    aboutImage: string;

    sandra: SandraData;
    centro: CentroData;
    galeria: GaleriaContent;

    servicesTitle: string;
    servicesSubtitle: string;

    testimonialsTitle: string;

    ctaTitle: string;
    ctaSubtitle: string;

    footerText: string;
    phone: string;
    whatsapp: string;
    email: string;
    address: string;
    socialInstagram: string;
    socialFacebook: string;
    socialTwitter: string;
}

// ============================================
// MEDIA LIBRARY
// ============================================

export interface MediaFolder {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: string;
}

export interface MediaFile {
    id: string;
    name: string;
    url: string;
    storagePath: string;
    folderId: string | null;
    type: 'image' | 'video';
    size: number;
    createdAt: string;
}

export interface UploadProgress {
    fileName: string;
    progress: number;
    status: 'uploading' | 'done' | 'error';
}

// ============================================
// GALLERY ITEMS
// ============================================

export interface GalleryItem {
    id: string;
    mediaFileId: string;
    url: string;
    type: 'image' | 'video';
    title: string;
    order: number;
    active: boolean;
    createdAt: string;
}
