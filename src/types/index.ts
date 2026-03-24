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
    duration: '30' | '60' | '90';
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
    time: string;       // "HH:00"
    reason?: string;
    createdBy: string;  // uid del admin
    createdAt: string;
}

export interface SlotOccupancy {
    date: string;       // "YYYY-MM-DD"
    time: string;       // "HH:00"
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
    startHour: number;        // ej: 8
    endHour: number;          // ej: 20
    sessionDuration: number;  // en minutos: 60
    bonoExpirationMonths: number; // meses de validez de los bonos (default: 1)
}

// ============================================
// BONOS
// ============================================

export interface BonoHistorialEntry {
    fecha: string;          // ISO date de la sesión
    tipo: string;           // nombre del servicio o "Deducción manual"
    duracion: string;       // '30' | '60' | duración en minutos
    appointmentId: string;  // ref a appointments/{id} o 'manual'
}

export interface Bono {
    id: string;
    userId: string;                              // ref a users/{uid}
    tipo: 'sesion_personal' | 'bono_mensual';
    sesionesTotales: number;                     // 1 | 4 | 8
    sesionesRestantes: number;
    modalidad?: '1h' | '30min';                  // solo para bono_mensual
    fechaAsignacion: string;                     // ISO date
    fechaExpiracion: string;                     // calculada
    estado: 'activo' | 'agotado' | 'expirado' | 'eliminado';
    historial: BonoHistorialEntry[];
    asignadoPor: string;                         // admin email
    createdAt: string;
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
