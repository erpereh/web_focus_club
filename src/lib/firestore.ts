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
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { v4 as uuidv4 } from 'uuid';
import type {
    UserProfile,
    Service,
    Appointment,
    Testimonial,
    CMSContent,
    SandraData,
    CentroConfig,
    CentroFeature,
    CentroZona,
    CentroData,
    GaleriaContent,
    ContactoConfig,
    ContactoCard,
    GaleriaTrainingItem,
    GaleriaResultado,
    GaleriaStat,
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
    BrandingConfig,
    HeroStat,
} from '@/types';

const DEFAULT_CENTRO_ZONAS: CentroZona[] = [
    {
        title: 'Entrada',
        description: 'Acceso exclusivo al centro, disenado para que tu experiencia comience desde el primer paso.',
        image: 'https://firebasestorage.googleapis.com/v0/b/focus-club-f73b8.firebasestorage.app/o/public%2Fimagenes%2Fel_centro%2Fentrada.jpeg?alt=media&token=220c18a8-87af-49a6-a0dd-68480c729ffe',
        active: true,
    },
    {
        title: 'Zona de Entrenamiento',
        description: 'Espacio equipado con todo lo necesario para tus sesiones de entrenamiento funcional y cardio.',
        image: 'https://firebasestorage.googleapis.com/v0/b/focus-club-f73b8.firebasestorage.app/o/public%2Fimagenes%2Fel_centro%2Fgym1.jpeg?alt=media&token=b1d33f31-9880-4be9-8346-38958e78aac2',
        active: true,
    },
    {
        title: 'Zona de Musculacion',
        description: 'Area dedicada al trabajo de fuerza con maquinaria y pesos libres de calidad profesional.',
        image: 'https://firebasestorage.googleapis.com/v0/b/focus-club-f73b8.firebasestorage.app/o/public%2Fimagenes%2Fel_centro%2Fgym3.jpeg?alt=media&token=19fdea88-575f-4adb-8d78-36457177b04b',
        active: true,
    },
    {
        title: 'Bano',
        description: 'Instalaciones limpias y bien equipadas para que puedas asearte comodamente tras tu sesion.',
        image: 'https://firebasestorage.googleapis.com/v0/b/focus-club-f73b8.firebasestorage.app/o/public%2Fimagenes%2Fel_centro%2Fba%C3%B1o.jpeg?alt=media&token=d4053e23-1633-416f-b708-56b0202f3bac',
        active: true,
    },
];

const DEFAULT_CENTRO_FEATURES: CentroFeature[] = [
    { icon: 'Sparkles', title: 'Equipamiento Premium', description: 'Marcas lideres en fitness y bienestar.' },
    { icon: 'Shield', title: 'Higiene Total', description: 'Protocolos estrictos de limpieza y desinfeccion.' },
    { icon: 'Zap', title: 'Tecnologia Avanzada', description: 'Herramientas de analisis y seguimiento.' },
    { icon: 'Users', title: 'Espacio Exclusivo', description: 'Solo citas previas, sin aglomeraciones.' },
];

export const DEFAULT_CENTRO_CONFIG: CentroConfig = {
    eyebrow: 'NUESTRAS INSTALACIONES',
    title: 'El Centro',
    subtitle: 'Un espacio disenado para tu transformacion.',
    description: 'Cada detalle ha sido pensado para ofrecerte la mejor experiencia. Un espacio exclusivo donde el entrenamiento personalizado, la privacidad y la calidad se fusionan.',
    zonasTitle: 'Nuestras Zonas',
    zonasSubtitle: 'Espacios pensados para cada etapa de tu entrenamiento',
    zonas: DEFAULT_CENTRO_ZONAS,
    featuresTitle: 'Por que elegirnos?',
    featuresSubtitle: 'Detalles que marcan la diferencia',
    features: DEFAULT_CENTRO_FEATURES,
    locationEyebrow: 'UBICACION',
    locationTitle: 'Como llegar',
    address: 'Focus Club Vallecas',
    schedule: 'Lunes a Viernes: 7:00 - 21:00 | Sabados: 9:00 - 14:00',
    phone: '+34 689 93 33 39',
    email: 'infofocusclub2026@gmail.com',
    ctaText: 'Reservar Visita',
    ctaLink: '/portal',
    mapUrl: 'https://maps.google.com/maps?q=C.+de+Pe%C3%B1aranda+de+Bracamonte+69+Local+4,Villa+de+Vallecas,28051+Madrid&output=embed',
};

const DEFAULT_GALERIA_STATS: GaleriaStat[] = [
    { value: '200+', label: 'Clientes transformados' },
    { value: '20 anos', label: 'De experiencia' },
    { value: '100%', label: 'Compromiso' },
];

const DEFAULT_GALERIA_TRAININGS: GaleriaTrainingItem[] = [
    { mediaUrl: '/imagenes/inventadas/entrenamiento-1.svg', mediaType: 'image', title: 'Entrenamiento de Fuerza', active: true },
    { mediaUrl: '/imagenes/inventadas/entrenamiento-2.svg', mediaType: 'image', title: 'Hipertrofia Muscular', active: true },
    { mediaUrl: '/imagenes/inventadas/entrenamiento-3.svg', mediaType: 'image', title: 'Cardio HIIT', active: true },
    { mediaUrl: '/imagenes/inventadas/entrenamiento-4.svg', mediaType: 'image', title: 'Nutricion Deportiva', active: true },
    { mediaUrl: '/imagenes/inventadas/entrenamiento-5.svg', mediaType: 'image', title: 'Prep. Competicion', active: true },
    { mediaUrl: '/imagenes/inventadas/entrenamiento-6.svg', mediaType: 'image', title: 'Seguimiento Progreso', active: true },
];

const DEFAULT_GALERIA_RESULTADOS: GaleriaResultado[] = [
    { metric: '-18 kg', period: 'en 4 meses', name: 'Maria Garcia', achievement: 'De 78 kg a 60 kg.', label: 'Perdida de peso', active: true },
    { metric: '+12 kg', period: 'masa muscular', name: 'Carlos Martinez', achievement: 'Programa de hipertrofia progresivo.', label: 'Hipertrofia', active: true },
    { metric: '1er', period: 'puesto competicion', name: 'Laura Perez', achievement: 'Preparacion completa para competicion.', label: 'Competicion', active: true },
    { metric: '100%', period: 'objetivo cumplido', name: 'Ana Rodriguez', achievement: 'Programa de definicion y tonificacion.', label: 'Definicion', active: true },
];

export const DEFAULT_GALERIA_CONFIG: GaleriaContent = {
    heroEyebrow: 'NUESTRA GALERIA',
    heroTitle: 'Galeria Focus Club Vallecas',
    heroSubtitle: 'Resultados reales, historias de transformacion autenticas.',
    statsTitle: 'Resultados Reales',
    statsSubtitle: '',
    stats: DEFAULT_GALERIA_STATS,
    trainingEyebrow: 'EN ACCION',
    trainingTitle: 'Entrenamientos',
    trainingSubtitle: 'Imagenes de las sesiones. Pasan automaticamente o navega con las flechas. Haz click para ampliar.',
    trainings: DEFAULT_GALERIA_TRAININGS,
    resultsEyebrow: 'HISTORIAS REALES',
    resultsTitle: 'Resultados',
    resultsSubtitle: 'Pasa el cursor sobre cada tarjeta para descubrir la historia detras del resultado.',
    resultados: DEFAULT_GALERIA_RESULTADOS,
    galleryEyebrow: 'FOCUS CLUB',
    galleryTitle: 'Galeria',
    gallerySubtitle: '',
};

const DEFAULT_CONTACTO_CARDS: ContactoCard[] = [
    {
        icon: 'MapPin',
        title: 'Direccion',
        content: 'C. de Penaranda de Bracamonte, 69, Local 4, Villa de Vallecas, 28051 Madrid',
        linkText: 'Abrir en Google Maps',
        linkUrl: 'https://maps.app.goo.gl/EHFk2xEh9xwHBaDKA',
        active: true,
    },
    {
        icon: 'Phone',
        title: 'Telefono',
        content: '+34 689 93 33 39',
        linkText: '+34 689 93 33 39',
        linkUrl: 'tel:+34689933339',
        active: true,
    },
    {
        icon: 'Mail',
        title: 'Email',
        content: 'infofocusclub2026@gmail.com',
        linkText: 'infofocusclub2026@gmail.com',
        linkUrl: 'mailto:infofocusclub2026@gmail.com',
        active: true,
    },
    {
        icon: 'Clock',
        title: 'Horario',
        content: 'L-V: 7:00-21:00 | S: 9:00-14:00',
        linkText: '',
        linkUrl: '',
        active: true,
    },
    {
        icon: 'MessageCircle',
        title: 'WhatsApp',
        content: 'Atencion directa por WhatsApp',
        linkText: 'Enviar mensaje directo',
        linkUrl: 'https://wa.me/34689933339',
        active: true,
    },
];

export const DEFAULT_CONTACTO_CONFIG: ContactoConfig = {
    heroEyebrow: 'CONTACTO',
    heroTitle: 'Hablamos?',
    heroSubtitle: 'Estamos aqui para responder tus preguntas y ayudarte a comenzar tu transformacion.',
    cards: DEFAULT_CONTACTO_CARDS,
    formTitle: '',
    formSubtitle: '',
    nameLabel: 'Nombre completo',
    namePlaceholder: 'Tu nombre',
    emailLabel: 'Email',
    emailPlaceholder: 'tu@email.com',
    phoneLabel: 'Telefono',
    phonePlaceholder: '+34 600 000 000',
    subjectLabel: 'Asunto',
    subjectPlaceholder: 'Selecciona un asunto',
    messageLabel: 'Mensaje',
    messagePlaceholder: 'En que podemos ayudarte?',
    subjects: [
        'Informacion general',
        'Entrenamiento personal',
        'Fisioterapia',
        'Pilates',
        'Nutricion',
        'Otro',
    ],
    submitText: 'Enviar Mensaje',
    successTitle: 'Mensaje enviado',
    successMessage: 'Te responderemos lo antes posible.',
    mapUrl: 'https://maps.google.com/maps?q=C.+de+Pe%C3%B1aranda+de+Bracamonte+69+Local+4,Villa+de+Vallecas,28051+Madrid&output=embed',
};

const DEFAULT_HOME_FIELDS: Pick<
    CMSContent,
    | 'heroBackgroundUrl'
    | 'heroBackgroundType'
    | 'aboutEyebrow'
    | 'aboutBadgeOneIcon'
    | 'aboutBadgeOneText'
    | 'aboutBadgeTwoIcon'
    | 'aboutBadgeTwoText'
    | 'aboutButtonText'
    | 'aboutButtonLink'
    | 'aboutCardName'
    | 'aboutCardRole'
> = {
    heroBackgroundUrl: '/imagenes/hero.mp4',
    heroBackgroundType: 'video',
    aboutEyebrow: 'Conoce a tu entrenadora',
    aboutBadgeOneIcon: 'Award',
    aboutBadgeOneText: 'Certificacion Internacional',
    aboutBadgeTwoIcon: 'Heart',
    aboutBadgeTwoText: 'Atencion Personalizada',
    aboutButtonText: 'Leer mas',
    aboutButtonLink: '/sandra',
    aboutCardName: 'Sandra Andujar',
    aboutCardRole: 'Fundadora & Coach Principal',
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNonEmptyString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function normalizeCentroConfig(rawCentro: unknown): CentroConfig {
    const raw = asRecord(rawCentro);
    const scheduleRaw = raw.schedule;
    let normalizedSchedule = DEFAULT_CENTRO_CONFIG.schedule;
    if (typeof scheduleRaw === 'string' && scheduleRaw.trim()) {
        normalizedSchedule = scheduleRaw;
    } else if (scheduleRaw && typeof scheduleRaw === 'object') {
        const scheduleObj = asRecord(scheduleRaw);
        const weekdays = typeof scheduleObj.weekdays === 'string' ? scheduleObj.weekdays.trim() : '';
        const saturday = typeof scheduleObj.saturday === 'string' ? scheduleObj.saturday.trim() : '';
        if (weekdays || saturday) {
            normalizedSchedule = [weekdays ? `Lunes a Viernes: ${weekdays}` : '', saturday ? `Sabados: ${saturday}` : '']
                .filter(Boolean)
                .join(' | ');
        }
    }

    const featuresRaw = Array.isArray(raw.features) ? raw.features : [];
    const normalizedFeatures = featuresRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
            icon: asNonEmptyString(item.icon, 'Sparkles'),
            title: asNonEmptyString(item.title, ''),
            description: asNonEmptyString(item.description, ''),
        }))
        .filter((item) => item.title || item.description);

    const zonasRaw = Array.isArray(raw.zonas) ? raw.zonas : [];
    let normalizedZonas: CentroZona[];
    if (zonasRaw.length > 0) {
        normalizedZonas = zonasRaw
            .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
            .map((item) => ({
                image: asNonEmptyString(item.image, ''),
                title: asNonEmptyString(item.title, ''),
                description: asNonEmptyString(item.description, ''),
                active: item.active === false ? false : true,
            }))
            .filter((item) => item.image || item.title || item.description);
    } else if (Array.isArray(raw.gallery)) {
        normalizedZonas = DEFAULT_CENTRO_ZONAS.map((zona) => ({ ...zona }));
    } else {
        normalizedZonas = DEFAULT_CENTRO_ZONAS.map((zona) => ({ ...zona }));
    }

    return {
        eyebrow: asNonEmptyString(raw.eyebrow, DEFAULT_CENTRO_CONFIG.eyebrow),
        title: asNonEmptyString(raw.title, DEFAULT_CENTRO_CONFIG.title),
        subtitle: asNonEmptyString(raw.subtitle, DEFAULT_CENTRO_CONFIG.subtitle),
        description: asNonEmptyString(raw.description, DEFAULT_CENTRO_CONFIG.description),
        zonasTitle: asNonEmptyString(raw.zonasTitle, DEFAULT_CENTRO_CONFIG.zonasTitle),
        zonasSubtitle: asNonEmptyString(raw.zonasSubtitle, DEFAULT_CENTRO_CONFIG.zonasSubtitle),
        zonas: normalizedZonas.length > 0 ? normalizedZonas : DEFAULT_CENTRO_ZONAS.map((zona) => ({ ...zona })),
        featuresTitle: asNonEmptyString(raw.featuresTitle, DEFAULT_CENTRO_CONFIG.featuresTitle),
        featuresSubtitle: asNonEmptyString(raw.featuresSubtitle, DEFAULT_CENTRO_CONFIG.featuresSubtitle),
        features: normalizedFeatures.length > 0 ? normalizedFeatures : DEFAULT_CENTRO_FEATURES.map((feature) => ({ ...feature })),
        locationEyebrow: asNonEmptyString(raw.locationEyebrow, DEFAULT_CENTRO_CONFIG.locationEyebrow),
        locationTitle: asNonEmptyString(raw.locationTitle, DEFAULT_CENTRO_CONFIG.locationTitle),
        address: asNonEmptyString(raw.address, DEFAULT_CENTRO_CONFIG.address),
        schedule: asNonEmptyString(normalizedSchedule, DEFAULT_CENTRO_CONFIG.schedule),
        phone: asNonEmptyString(raw.phone, DEFAULT_CENTRO_CONFIG.phone),
        email: asNonEmptyString(raw.email, DEFAULT_CENTRO_CONFIG.email),
        ctaText: asNonEmptyString(raw.ctaText, DEFAULT_CENTRO_CONFIG.ctaText),
        ctaLink: asNonEmptyString(raw.ctaLink, DEFAULT_CENTRO_CONFIG.ctaLink),
        mapUrl: asNonEmptyString(raw.mapUrl, DEFAULT_CENTRO_CONFIG.mapUrl),
    };
}

function parseStatValue(value: unknown, suffix: unknown): string {
    const base = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
    const suf = typeof suffix === 'string' ? suffix.trim() : '';
    if (!base && !suf) return '';
    return `${base}${suf}`.trim();
}

export function normalizeGaleriaConfig(rawGaleria: unknown): GaleriaContent {
    const raw = asRecord(rawGaleria);

    const statsRaw = Array.isArray(raw.stats) ? raw.stats : [];
    const stats = statsRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
            value: asNonEmptyString(item.value, parseStatValue(item.value, item.suffix)),
            label: asNonEmptyString(item.label, ''),
        }))
        .filter((item) => item.value || item.label);

    const trainingsRaw = Array.isArray(raw.trainings) ? raw.trainings : [];
    const trainings = trainingsRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item): GaleriaTrainingItem => ({
            mediaUrl: asNonEmptyString(item.mediaUrl, ''),
            mediaType: item.mediaType === 'video' ? 'video' : 'image',
            title: asNonEmptyString(item.title, ''),
            active: item.active === false ? false : true,
        }))
        .filter((item) => item.mediaUrl || item.title);

    const resultadosRaw = Array.isArray(raw.resultados) ? raw.resultados : [];
    const resultados = resultadosRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
            metric: asNonEmptyString(item.metric, asNonEmptyString(item.stat, '')),
            period: asNonEmptyString(item.period, asNonEmptyString(item.statLabel, '')),
            name: asNonEmptyString(item.name, ''),
            achievement: asNonEmptyString(item.achievement, asNonEmptyString(item.detail, asNonEmptyString(item.story, ''))),
            label: asNonEmptyString(item.label, asNonEmptyString(item.tag, '')),
            active: item.active === false ? false : true,
        }))
        .filter((item) => item.metric || item.name || item.achievement || item.label);

    return {
        heroEyebrow: asNonEmptyString(raw.heroEyebrow, DEFAULT_GALERIA_CONFIG.heroEyebrow ?? ''),
        heroTitle: asNonEmptyString(raw.heroTitle, DEFAULT_GALERIA_CONFIG.heroTitle),
        heroSubtitle: asNonEmptyString(raw.heroSubtitle, DEFAULT_GALERIA_CONFIG.heroSubtitle),
        statsTitle: asNonEmptyString(raw.statsTitle, DEFAULT_GALERIA_CONFIG.statsTitle ?? ''),
        statsSubtitle: asNonEmptyString(raw.statsSubtitle, DEFAULT_GALERIA_CONFIG.statsSubtitle ?? ''),
        stats: stats.length > 0 ? stats : DEFAULT_GALERIA_STATS.map((item) => ({ ...item })),
        trainingEyebrow: asNonEmptyString(raw.trainingEyebrow, DEFAULT_GALERIA_CONFIG.trainingEyebrow ?? ''),
        trainingTitle: asNonEmptyString(raw.trainingTitle, DEFAULT_GALERIA_CONFIG.trainingTitle ?? ''),
        trainingSubtitle: asNonEmptyString(raw.trainingSubtitle, DEFAULT_GALERIA_CONFIG.trainingSubtitle ?? ''),
        trainings: trainings.length > 0 ? trainings : DEFAULT_GALERIA_TRAININGS.map((item) => ({ ...item })),
        resultsEyebrow: asNonEmptyString(raw.resultsEyebrow, DEFAULT_GALERIA_CONFIG.resultsEyebrow ?? ''),
        resultsTitle: asNonEmptyString(raw.resultsTitle, DEFAULT_GALERIA_CONFIG.resultsTitle ?? ''),
        resultsSubtitle: asNonEmptyString(raw.resultsSubtitle, DEFAULT_GALERIA_CONFIG.resultsSubtitle ?? ''),
        resultados: resultados.length > 0 ? resultados : DEFAULT_GALERIA_RESULTADOS.map((item) => ({ ...item })),
        galleryEyebrow: asNonEmptyString(raw.galleryEyebrow, DEFAULT_GALERIA_CONFIG.galleryEyebrow ?? ''),
        galleryTitle: asNonEmptyString(raw.galleryTitle, DEFAULT_GALERIA_CONFIG.galleryTitle ?? ''),
        gallerySubtitle: asNonEmptyString(raw.gallerySubtitle, DEFAULT_GALERIA_CONFIG.gallerySubtitle ?? ''),
        transformaciones: Array.isArray(raw.transformaciones) ? (raw.transformaciones as { name: string; periodo: string; resultado: string }[]) : [],
    };
}

export function normalizeContactoConfig(rawContacto: unknown): ContactoConfig {
    const raw = asRecord(rawContacto);

    const cardsRaw = Array.isArray(raw.cards) ? raw.cards : [];
    const cards = cardsRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
            icon: asNonEmptyString(item.icon, 'MapPin'),
            title: asNonEmptyString(item.title, ''),
            content: asNonEmptyString(item.content, ''),
            linkText: typeof item.linkText === 'string' ? item.linkText : '',
            linkUrl: typeof item.linkUrl === 'string' ? item.linkUrl : '',
            active: item.active === false ? false : true,
        }))
        .filter((item) => item.title || item.content || item.linkText || item.linkUrl);

    const subjectsRaw = Array.isArray(raw.subjects) ? raw.subjects : [];
    const subjects = subjectsRaw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);

    return {
        heroEyebrow: asNonEmptyString(raw.heroEyebrow, DEFAULT_CONTACTO_CONFIG.heroEyebrow),
        heroTitle: asNonEmptyString(raw.heroTitle, DEFAULT_CONTACTO_CONFIG.heroTitle),
        heroSubtitle: asNonEmptyString(raw.heroSubtitle, DEFAULT_CONTACTO_CONFIG.heroSubtitle),
        cards: cards.length > 0 ? cards : DEFAULT_CONTACTO_CARDS.map((item) => ({ ...item })),
        formTitle: typeof raw.formTitle === 'string' ? raw.formTitle : DEFAULT_CONTACTO_CONFIG.formTitle,
        formSubtitle: typeof raw.formSubtitle === 'string' ? raw.formSubtitle : DEFAULT_CONTACTO_CONFIG.formSubtitle,
        nameLabel: asNonEmptyString(raw.nameLabel, DEFAULT_CONTACTO_CONFIG.nameLabel),
        namePlaceholder: asNonEmptyString(raw.namePlaceholder, DEFAULT_CONTACTO_CONFIG.namePlaceholder),
        emailLabel: asNonEmptyString(raw.emailLabel, DEFAULT_CONTACTO_CONFIG.emailLabel),
        emailPlaceholder: asNonEmptyString(raw.emailPlaceholder, DEFAULT_CONTACTO_CONFIG.emailPlaceholder),
        phoneLabel: asNonEmptyString(raw.phoneLabel, DEFAULT_CONTACTO_CONFIG.phoneLabel),
        phonePlaceholder: asNonEmptyString(raw.phonePlaceholder, DEFAULT_CONTACTO_CONFIG.phonePlaceholder),
        subjectLabel: asNonEmptyString(raw.subjectLabel, DEFAULT_CONTACTO_CONFIG.subjectLabel),
        subjectPlaceholder: asNonEmptyString(raw.subjectPlaceholder, DEFAULT_CONTACTO_CONFIG.subjectPlaceholder),
        messageLabel: asNonEmptyString(raw.messageLabel, DEFAULT_CONTACTO_CONFIG.messageLabel),
        messagePlaceholder: asNonEmptyString(raw.messagePlaceholder, DEFAULT_CONTACTO_CONFIG.messagePlaceholder),
        subjects: subjects.length > 0 ? subjects : [...DEFAULT_CONTACTO_CONFIG.subjects],
        submitText: asNonEmptyString(raw.submitText, DEFAULT_CONTACTO_CONFIG.submitText),
        successTitle: asNonEmptyString(raw.successTitle, DEFAULT_CONTACTO_CONFIG.successTitle),
        successMessage: asNonEmptyString(raw.successMessage, DEFAULT_CONTACTO_CONFIG.successMessage),
        mapUrl: asNonEmptyString(raw.mapUrl, DEFAULT_CONTACTO_CONFIG.mapUrl),
    };
}

function normalizeHomeFields(raw: CMSContent): CMSContent {
    return {
        ...raw,
        heroBackgroundUrl: asNonEmptyString(raw.heroBackgroundUrl, DEFAULT_HOME_FIELDS.heroBackgroundUrl ?? '/imagenes/hero.mp4'),
        heroBackgroundType: raw.heroBackgroundType === 'image' ? 'image' : 'video',
        aboutEyebrow: asNonEmptyString(raw.aboutEyebrow, DEFAULT_HOME_FIELDS.aboutEyebrow ?? 'Conoce a tu entrenadora'),
        aboutBadgeOneIcon: asNonEmptyString(raw.aboutBadgeOneIcon, DEFAULT_HOME_FIELDS.aboutBadgeOneIcon ?? 'Award'),
        aboutBadgeOneText: asNonEmptyString(raw.aboutBadgeOneText, DEFAULT_HOME_FIELDS.aboutBadgeOneText ?? 'Certificacion Internacional'),
        aboutBadgeTwoIcon: asNonEmptyString(raw.aboutBadgeTwoIcon, DEFAULT_HOME_FIELDS.aboutBadgeTwoIcon ?? 'Heart'),
        aboutBadgeTwoText: asNonEmptyString(raw.aboutBadgeTwoText, DEFAULT_HOME_FIELDS.aboutBadgeTwoText ?? 'Atencion Personalizada'),
        aboutButtonText: asNonEmptyString(raw.aboutButtonText, DEFAULT_HOME_FIELDS.aboutButtonText ?? 'Leer mas'),
        aboutButtonLink: asNonEmptyString(raw.aboutButtonLink, DEFAULT_HOME_FIELDS.aboutButtonLink ?? '/sandra'),
        aboutCardName: asNonEmptyString(raw.aboutCardName, DEFAULT_HOME_FIELDS.aboutCardName ?? 'Sandra Andujar'),
        aboutCardRole: asNonEmptyString(raw.aboutCardRole, DEFAULT_HOME_FIELDS.aboutCardRole ?? 'Fundadora & Coach Principal'),
        contacto: normalizeContactoConfig(raw.contacto),
    };
}

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
    if (!snap.exists()) return null;
    const data = snap.data() as CMSContent & { centro?: unknown; galeria?: unknown; contacto?: unknown };
    const normalized = {
        ...data,
        centro: normalizeCentroConfig(data.centro),
        galeria: normalizeGaleriaConfig(data.galeria),
        contacto: normalizeContactoConfig(data.contacto),
    } as CMSContent;
    return normalizeHomeFields(normalized);
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

export async function getCentroConfig(): Promise<CentroConfig | null> {
    const snap = await getDoc(doc(db, 'site_content', SITE_CONTENT_DOC));
    if (!snap.exists()) return null;
    return normalizeCentroConfig((snap.data() as { centro?: unknown }).centro);
}

export async function updateCentroConfig(data: Partial<CentroConfig>): Promise<void> {
    const current = await getCentroConfig();
    const base = current ?? DEFAULT_CENTRO_CONFIG;
    const merged = normalizeCentroConfig({
        ...base,
        ...data,
        zonas: data.zonas ?? base.zonas,
        features: data.features ?? base.features,
    });
    await setDoc(doc(db, 'site_content', SITE_CONTENT_DOC), { centro: merged }, { merge: true });
}

export async function updateCentroData(data: Partial<CentroData>): Promise<void> {
    await updateCentroConfig(data as Partial<CentroConfig>);
}

export async function getGaleriaConfig(): Promise<GaleriaContent | null> {
    const snap = await getDoc(doc(db, 'site_content', SITE_CONTENT_DOC));
    if (!snap.exists()) return null;
    return normalizeGaleriaConfig((snap.data() as { galeria?: unknown }).galeria);
}

export async function updateGaleriaConfig(data: Partial<GaleriaContent>): Promise<void> {
    const current = await getGaleriaConfig();
    const base = current ?? DEFAULT_GALERIA_CONFIG;
    const merged = normalizeGaleriaConfig({
        ...base,
        ...data,
        stats: data.stats ?? base.stats,
        trainings: data.trainings ?? base.trainings,
        resultados: data.resultados ?? base.resultados,
    });
    await setDoc(doc(db, 'site_content', SITE_CONTENT_DOC), { galeria: merged }, { merge: true });
}

export async function updateGaleriaData(data: GaleriaContent): Promise<void> {
    await updateGaleriaConfig(data);
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

export async function getMediaFileById(id: string): Promise<MediaFile | null> {
    const snap = await getDoc(doc(db, 'media_files', id));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
        id: snap.id,
        name: data.name,
        url: data.url,
        storagePath: data.storagePath,
        folderId: data.folderId ?? null,
        type: data.type,
        size: data.size,
        createdAt: data.createdAt?.toDate?.().toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
    };
}

export async function getMediaFileByUrl(url: string): Promise<MediaFile | null> {
    const trimmed = url.trim();
    if (!trimmed) return null;
    const snap = await getDocs(query(collection(db, 'media_files'), where('url', '==', trimmed)));
    if (snap.empty) return null;
    const first = snap.docs[0];
    const data = first.data();
    return {
        id: first.id,
        name: data.name,
        url: data.url,
        storagePath: data.storagePath,
        folderId: data.folderId ?? null,
        type: data.type,
        size: data.size,
        createdAt: data.createdAt?.toDate?.().toISOString?.() ?? data.createdAt ?? new Date().toISOString(),
    };
}

function getExtensionFromPath(path: string, fallbackType: 'image' | 'video'): string {
    const fromPath = path.split('.').pop()?.toLowerCase();
    if (fromPath && fromPath.length <= 5) return fromPath;
    return fallbackType === 'video' ? 'mp4' : 'jpg';
}

export async function moveMediaAsset(
    mediaFile: MediaFile,
    destinationFolderId: string | null,
    destinationBasePath?: string
): Promise<MediaFile> {
    const ext = getExtensionFromPath(mediaFile.storagePath, mediaFile.type);
    const newStoragePath = destinationBasePath
        ? `${destinationBasePath}/${uuidv4()}.${ext}`
        : `media/root/${uuidv4()}.${ext}`;

    if (mediaFile.storagePath === newStoragePath && mediaFile.folderId === destinationFolderId) {
        return mediaFile;
    }

    const oldRef = ref(storage, mediaFile.storagePath);
    const oldUrl = await getDownloadURL(oldRef);
    const response = await fetch(oldUrl);
    if (!response.ok) {
        throw new Error(`No se pudo descargar el asset origen: ${mediaFile.name}`);
    }
    const blob = await response.blob();
    const newRef = ref(storage, newStoragePath);
    await uploadBytes(newRef, blob, {
        contentType: blob.type || (mediaFile.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    });
    const newUrl = await getDownloadURL(newRef);

    try {
        await deleteObject(oldRef);
    } catch {
        // If the old object is already gone, keep metadata migration.
    }

    await updateMediaFile(mediaFile.id, {
        storagePath: newStoragePath,
        url: newUrl,
        folderId: destinationFolderId,
    });

    return {
        ...mediaFile,
        storagePath: newStoragePath,
        url: newUrl,
        folderId: destinationFolderId,
    };
}

export async function moveMediaAssetToGeneralByUrl(url: string): Promise<MediaFile | null> {
    const media = await getMediaFileByUrl(url);
    if (!media) return null;
    return moveMediaAsset(media, null);
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
    const folderRef = await addDoc(collection(db, 'media_folders'), {
        name: 'Galería Pública',
        parentId: null,
        createdAt: Timestamp.now(),
    });
    await setDoc(configRef, { folderId: folderRef.id });
    return { folderId: folderRef.id };
}

export async function getOrCreateBrandingFolder(): Promise<{ folderId: string }> {
    const configRef = doc(db, 'system_config', 'branding_folder');
    const configSnap = await getDoc(configRef);
    if (configSnap.exists()) {
        return { folderId: configSnap.data().folderId as string };
    }
    const folderRef = await addDoc(collection(db, 'media_folders'), {
        name: 'Branding',
        parentId: null,
        createdAt: Timestamp.now(),
    });
    await setDoc(configRef, { folderId: folderRef.id });
    return { folderId: folderRef.id };
}

// ============================================
// BRANDING CONFIG
// ============================================

export async function getBrandingConfig(): Promise<BrandingConfig | null> {
    const snap = await getDoc(doc(db, 'site_config', 'general'));
    return snap.exists() ? (snap.data() as BrandingConfig) : null;
}

export async function updateBrandingConfig(data: Partial<BrandingConfig>): Promise<void> {
    await setDoc(doc(db, 'site_config', 'general'), data, { merge: true });
}

export async function getOrCreateSandraFolder(): Promise<{ folderId: string }> {
    const configRef = doc(db, 'system_config', 'sandra_folder');
    const configSnap = await getDoc(configRef);
    if (configSnap.exists()) {
        return { folderId: configSnap.data().folderId as string };
    }
    const folderRef = await addDoc(collection(db, 'media_folders'), {
        name: 'Sandra',
        parentId: null,
        createdAt: Timestamp.now(),
    });
    await setDoc(configRef, { folderId: folderRef.id });
    return { folderId: folderRef.id };
}

export async function getOrCreateCentroFolder(): Promise<{ folderId: string }> {
    const configRef = doc(db, 'system_config', 'centro_folder');
    const configSnap = await getDoc(configRef);
    if (configSnap.exists()) {
        return { folderId: configSnap.data().folderId as string };
    }
    const folderRef = await addDoc(collection(db, 'media_folders'), {
        name: 'El Centro',
        parentId: null,
        createdAt: Timestamp.now(),
    });
    await setDoc(configRef, { folderId: folderRef.id });
    return { folderId: folderRef.id };
}

export async function getOrCreateHomeFolder(): Promise<{ folderId: string }> {
    const configRef = doc(db, 'system_config', 'home_folder');
    const configSnap = await getDoc(configRef);
    if (configSnap.exists()) {
        return { folderId: configSnap.data().folderId as string };
    }
    const folderRef = await addDoc(collection(db, 'media_folders'), {
        name: 'Home',
        parentId: null,
        createdAt: Timestamp.now(),
    });
    await setDoc(configRef, { folderId: folderRef.id });
    return { folderId: folderRef.id };
}

// ============================================
// HERO CONFIG
// ============================================

export interface HeroConfig {
    heroEyebrow?: string;
    heroTitleStart?: string;
    heroTitleHighlight?: string;
    heroCtaPrimaryLink?: string;
    heroCtaSecondaryText?: string;
    heroCtaSecondaryLink?: string;
    heroStats?: HeroStat[];
}

export async function getHeroConfig(): Promise<HeroConfig | null> {
    const snap = await getDoc(doc(db, 'site_content', 'main'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
        heroEyebrow: d.heroEyebrow,
        heroTitleStart: d.heroTitleStart,
        heroTitleHighlight: d.heroTitleHighlight,
        heroCtaPrimaryLink: d.heroCtaPrimaryLink,
        heroCtaSecondaryText: d.heroCtaSecondaryText,
        heroCtaSecondaryLink: d.heroCtaSecondaryLink,
        heroStats: d.heroStats,
    };
}

export async function updateHeroConfig(data: Partial<HeroConfig>): Promise<void> {
    await setDoc(doc(db, 'site_content', 'main'), data, { merge: true });
}
