import type { Timestamp } from 'firebase/firestore';

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

// ============================================
// CHAT DE SOPORTE
// ============================================

export type SupportConversationStatus = 'open' | 'closed';
export type SupportSenderRole = 'customer' | 'admin';

export interface SupportConversation {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    status: SupportConversationStatus;
    subject: string;
    lastMessage: string;
    lastMessageAt: Timestamp | null;
    lastMessageBy: SupportSenderRole;
    unreadAdminCount: number;
    unreadCustomerCount: number;
    createdAt: Timestamp | null;
    updatedAt: Timestamp | null;
    adminHidden?: boolean;
    adminHiddenAt?: Timestamp | null;
    adminHiddenBy?: string | null;
}

export interface SupportMessage {
    id: string;
    senderId: string;
    senderRole: SupportSenderRole;
    text: string;
    createdAt: Timestamp | null;
}

// ============================================
// SUGERENCIAS DE CLIENTES
// ============================================

export type CustomerSuggestionStatus = 'new' | 'reviewed' | 'archived';

export interface CustomerSuggestion {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    subject: string | null;
    message: string;
    status: CustomerSuggestionStatus;
    createdAt: Timestamp | null;
    updatedAt: Timestamp | null;
    reviewedAt: Timestamp | null;
    reviewedBy: string | null;
    reviewedByEmail: string | null;
    archivedAt: Timestamp | null;
    archivedBy: string | null;
    archivedByEmail: string | null;
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
    ctaText?: string;
    ctaLink?: string;
    active?: boolean;
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
    status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    approvedSlot?: TimeSlot;
    assignedTrainer?: string;
    sessionType?: string;
    trainerNotes?: string;
    /** Bono del que se descontaron los minutos de esta cita. */
    bonoId?: string;
    minutesDeducted?: boolean;
    minutesDeductedAmount?: number;
    minutesDeductedAt?: string;
    minutesDeductionSkippedAt?: string;
    minutesDeductionSkippedReason?: string;
    minutesRefunded?: boolean;
    minutesRefundedAmount?: number;
    minutesRefundedAt?: string | null;
    minutesRefundReason?: string | null;
    cancelledBy?: string;
    cancelledAt?: string;
    cancellationReason?: string;
    modifiedBy?: string;
    modifiedAt?: string;
    previousPreferredSlot?: TimeSlot | null;
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
    source?: 'manual' | 'google';
    googleReviewId?: string;
    reviewCreateTime?: string;
    reviewUpdateTime?: string;
    importedAt?: string;
    createdAt?: string;
    updatedAt?: string;
    approvedAt?: string;
}

export interface SandraAchievement {
    icon: string;
    title: string;
    description: string;
}

export interface SandraValue {
    icon: string;
    title: string;
    description: string;
}

export interface SandraData {
    name: string;
    title: string;
    subtitle: string;
    bio: string;
    experience: string;
    achievements: SandraAchievement[];
    certifications: string[];
    timeline: {
        year: string;
        title: string;
        description: string;
    }[];
    image: string;
    eyebrow?: string;
    valuesEyebrow?: string;
    valuesTitle?: string;
    values?: SandraValue[];
    timelineEyebrow?: string;
    timelineTitle?: string;
    certsEyebrow?: string;
    certsTitle?: string;
    certsSubtitle?: string;
    ctaTitle?: string;
    ctaDescription?: string;
    ctaButtonText?: string;
    ctaButtonLink?: string;
}

export interface CentroZona {
    image: string;
    title: string;
    description: string;
    active?: boolean;
}

export interface CentroFeature {
    icon: string;
    title: string;
    description: string;
}

export interface CentroConfig {
    eyebrow: string;
    title: string;
    subtitle: string;
    description: string;
    zonasTitle: string;
    zonasSubtitle: string;
    zonas: CentroZona[];
    featuresTitle: string;
    featuresSubtitle: string;
    features: CentroFeature[];
    locationEyebrow: string;
    locationTitle: string;
    address: string;
    schedule: string;
    phone: string;
    email: string;
    ctaText: string;
    ctaLink: string;
    mapUrl: string;
}

// Backward-compatible alias used across the app.
export type CentroData = CentroConfig;

export interface SiteConfig {
    startHour: number;         // ej: 8
    endHour: number;           // ej: 20
    slotInterval: number;      // intervalo de slots en minutos (default: 30)
    bonoExpirationMonths: number; // meses de validez de los bonos (default: 1)
    maintenanceMode?: boolean; // modo mantenimiento para web pública y portal cliente
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
    fechaAsignacion: string;   // ISO date de inicio del bono
    fechaExpiracion: string;   // ISO date de fin del bono
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
    if (bono.minutosRestantes !== undefined) {
        const total = getBonoMinutosTotales(bono);
        return Math.max(0, Math.min(bono.minutosRestantes, total));
    }
    const minPerSession = bono.modalidad === '30min' ? 30 : 60;
    return (bono.sesionesRestantes ?? 0) * minPerSession;
}

/** Devuelve los minutos totales del bono, con soporte para bonos legacy. */
export function getBonoMinutosTotales(bono: Bono): number {
    if (bono.tamano !== undefined && bono.minutosTotales !== undefined) {
        return Math.max(bono.tamano, bono.minutosTotales);
    }
    if (bono.minutosTotales !== undefined) return bono.minutosTotales;
    if (bono.tamano !== undefined) return bono.tamano;
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

export interface GaleriaStat {
    value: string;
    label: string;
    suffix?: string; // legacy compat
}

export interface GaleriaTrainingItem {
    mediaUrl: string;
    mediaType: 'image' | 'video';
    title: string;
    active?: boolean;
}

export interface GaleriaResultado {
    metric: string;
    period: string;
    name: string;
    achievement: string;
    label: string;
    active?: boolean;
    // legacy compat
    stat?: string;
    statLabel?: string;
    tag?: string;
    story?: string;
    detail?: string;
}

export interface GaleriaContent {
    heroEyebrow?: string;
    heroTitle: string;
    heroSubtitle: string;
    statsTitle?: string;
    statsSubtitle?: string;
    stats: GaleriaStat[];
    trainingEyebrow?: string;
    trainingTitle?: string;
    trainingSubtitle?: string;
    trainings?: GaleriaTrainingItem[];
    resultsEyebrow?: string;
    resultsTitle?: string;
    resultsSubtitle?: string;
    resultados: GaleriaResultado[];
    galleryEyebrow?: string;
    galleryTitle?: string;
    gallerySubtitle?: string;
    // legacy compat
    transformaciones?: { name: string; periodo: string; resultado: string }[];
}

export interface ContactoCard {
    icon: string;
    title: string;
    content: string;
    linkText?: string;
    linkUrl?: string;
    active?: boolean;
}

export interface ContactoConfig {
    heroEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    cards: ContactoCard[];
    formTitle?: string;
    formSubtitle?: string;
    formRecipientEmail?: string;
    nameLabel: string;
    namePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    phoneLabel: string;
    phonePlaceholder: string;
    subjectLabel: string;
    subjectPlaceholder: string;
    messageLabel: string;
    messagePlaceholder: string;
    subjects: string[];
    submitText: string;
    successTitle: string;
    successMessage: string;
    mapUrl: string;
}

export interface HeroStat {
    icon: string;
    value: string;
    label: string;
}

export interface CMSContent {
    heroTitle: string;
    heroSubtitle: string;
    heroCTA: string;
    heroImage: string;
    heroBackgroundUrl?: string;
    heroBackgroundType?: 'video' | 'image';
    heroEyebrow?: string;
    heroTitleStart?: string;
    heroTitleHighlight?: string;
    heroCtaPrimaryLink?: string;
    heroCtaSecondaryText?: string;
    heroCtaSecondaryLink?: string;
    heroStats?: HeroStat[];

    aboutEyebrow?: string;
    aboutTitle: string;
    aboutText: string;
    aboutImage: string;
    aboutBadgeOneIcon?: string;
    aboutBadgeOneText?: string;
    aboutBadgeTwoIcon?: string;
    aboutBadgeTwoText?: string;
    aboutButtonText?: string;
    aboutButtonLink?: string;
    aboutCardName?: string;
    aboutCardRole?: string;

    sandra: SandraData;
    centro: CentroData;
    galeria: GaleriaContent;
    contacto?: ContactoConfig;

    servicesTitle: string;
    servicesSubtitle: string;
    servicesEyebrow?: string;
    servicesFaqsTitle?: string;
    servicesFaqs?: { question: string; answer: string }[];

    testimonialsEyebrow?: string;
    testimonialsTitle: string;

    ctaTitle: string;
    ctaSubtitle: string;
    ctaButtonText?: string;
    ctaButtonLink?: string;

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

// ============================================
// BRANDING CONFIG
// ============================================

export interface BrandingConfig {
    logoUrl: string;
    logoStoragePath: string;
    updatedAt: string;
}
