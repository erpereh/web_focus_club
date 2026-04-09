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

// ============================================
// BRANDING CONFIG
// ============================================

export interface BrandingConfig {
    logoUrl: string;
    logoStoragePath: string;
    updatedAt: string;
}
