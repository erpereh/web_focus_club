'use client';

import { useState, useEffect } from 'react';
import { getSiteContent, getServices, getApprovedTestimonials, getTestimonials } from '@/lib/firestore';
import type { CMSContent, Service, Testimonial } from '@/types';

// Datos por defecto (usados mientras se carga Firestore o si falla)
export const defaultCMS: CMSContent = {
    heroTitle: 'Centro premium de bienestar y transformacion fisica',
    heroSubtitle: 'Descubre un espacio exclusivo donde el entrenamiento personalizado, la preparacion para competicion y la nutricion se fusionan para alcanzar tus mejores resultados.',
    heroCTA: 'Solicitar Cita',
    heroImage: '/images/hero-gym.png',
    heroBackgroundUrl: '/imagenes/hero.mp4',
    heroBackgroundType: 'video',
    heroEyebrow: 'Bienvenido a Focus Club Vallecas',
    heroTitleStart: 'Transforma Tu',
    heroTitleHighlight: 'Cuerpo y Mente',
    heroCtaPrimaryLink: '/portal',
    heroCtaSecondaryText: 'Ver Servicios',
    heroCtaSecondaryLink: '/servicios',
    heroStats: [
        { icon: 'Award', value: '15+', label: 'Anos de Experiencia' },
        { icon: 'Users', value: '500+', label: 'Clientes Satisfechos' },
        { icon: 'Dumbbell', value: '4', label: 'Servicios Premium' },
        { icon: 'Heart', value: '100%', label: 'Compromiso' },
    ],
    aboutEyebrow: 'Conoce a tu entrenadora',
    aboutTitle: 'Sandra Andujar',
    aboutText: 'Con mas de 20 anos de experiencia en el mundo del fitness de competicion, Sandra Andujar es una referencia en entrenamiento de hipertrofia y preparacion fisica de elite.',
    aboutImage: 'https://firebasestorage.googleapis.com/v0/b/focus-club-f73b8.firebasestorage.app/o/public%2Fimagenes%2Fsandra.jpg?alt=media&token=b0af9bd2-add1-4e06-9e08-ee48e03fafe9',
    aboutBadgeOneIcon: 'Award',
    aboutBadgeOneText: 'Certificacion Internacional',
    aboutBadgeTwoIcon: 'Heart',
    aboutBadgeTwoText: 'Atencion Personalizada',
    aboutButtonText: 'Leer mas',
    aboutButtonLink: '/sandra',
    aboutCardName: 'Sandra Andujar',
    aboutCardRole: 'Fundadora & Coach Principal',
    sandra: {
        name: 'Sandra Andujar',
        title: 'PREPARADORA FISICA & T.NUTRICIONISTA',
        subtitle: 'La experta detras del proyecto',
        bio: 'Con mas de 20 anos de experiencia en el mundo del fitness de competicion, Sandra Andujar es una referencia en entrenamiento de hipertrofia y preparacion fisica de elite.',
        experience: '20+ anos',
        image: '',
        eyebrow: 'La experta detras del proyecto',
        achievements: [],
        certifications: [],
        timeline: [],
        valuesEyebrow: 'Filosofia de trabajo',
        valuesTitle: 'Valores que nos definen',
        values: [
            { icon: 'Heart', title: 'Dedicacion Total', description: 'Cada cliente recibe atencion personalizada y seguimiento constante.' },
            { icon: 'Target', title: 'Metodologia Cientifica', description: 'Programas basados en evidencia cientifica y resultados medibles.' },
            { icon: 'Users', title: 'Comunidad de Campeones', description: 'Un entorno exclusivo donde cada miembro persigue la excelencia.' },
        ],
        timelineEyebrow: 'Trayectoria profesional',
        timelineTitle: 'Un camino de dedicacion',
        certsEyebrow: 'Formacion academica',
        certsTitle: 'Certificaciones y titulos',
        certsSubtitle: 'Una formacion continua y rigurosa que garantiza la maxima calidad en cada sesion.',
        ctaTitle: 'Listo para empezar?',
        ctaDescription: 'Reserva tu primera consulta gratuita y descubre como podemos ayudarte.',
        ctaButtonText: 'Reservar Cita',
        ctaButtonLink: '/portal',
    },
    centro: {
        eyebrow: 'NUESTRAS INSTALACIONES',
        title: 'El Centro',
        subtitle: 'Un espacio disenado para tu transformacion.',
        description: 'Cada detalle ha sido pensado para ofrecerte la mejor experiencia. Un espacio exclusivo donde el entrenamiento personalizado, la privacidad y la calidad se fusionan.',
        zonasTitle: 'Nuestras Zonas',
        zonasSubtitle: 'Espacios pensados para cada etapa de tu entrenamiento',
        zonas: [
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
        ],
        featuresTitle: 'Por que elegirnos?',
        featuresSubtitle: 'Detalles que marcan la diferencia',
        features: [
            { icon: 'Sparkles', title: 'Equipamiento Premium', description: 'Marcas lideres en fitness y bienestar.' },
            { icon: 'Shield', title: 'Higiene Total', description: 'Protocolos estrictos de limpieza y desinfeccion.' },
            { icon: 'Zap', title: 'Tecnologia Avanzada', description: 'Herramientas de analisis y seguimiento.' },
            { icon: 'Users', title: 'Espacio Exclusivo', description: 'Solo citas previas, sin aglomeraciones.' },
        ],
        locationEyebrow: 'UBICACION',
        locationTitle: 'Como llegar',
        address: 'Focus Club Vallecas',
        schedule: 'Lunes a Viernes: 7:00 - 21:00 | Sabados: 9:00 - 14:00',
        phone: '+34 689 93 33 39',
        email: 'infofocusclub2026@gmail.com',
        ctaText: 'Reservar Visita',
        ctaLink: '/portal',
        mapUrl: 'https://maps.google.com/maps?q=C.+de+Pe%C3%B1aranda+de+Bracamonte+69+Local+4,Villa+de+Vallecas,28051+Madrid&output=embed',
    },
    galeria: {
        heroEyebrow: 'NUESTRA GALERIA',
        heroTitle: 'Galeria Focus Club Vallecas',
        heroSubtitle: 'Resultados reales, historias de transformacion autenticas.',
        statsTitle: 'Resultados Reales',
        statsSubtitle: '',
        stats: [
            { value: '200+', label: 'Clientes transformados' },
            { value: '20 anos', label: 'De experiencia' },
            { value: '100%', label: 'Compromiso' },
        ],
        trainingEyebrow: 'EN ACCION',
        trainingTitle: 'Entrenamientos',
        trainingSubtitle: 'Imagenes de las sesiones. Pasan automaticamente o navega con las flechas. Haz click para ampliar.',
        trainings: [
            { mediaUrl: '/imagenes/inventadas/entrenamiento-1.svg', mediaType: 'image', title: 'Entrenamiento de Fuerza', active: true },
            { mediaUrl: '/imagenes/inventadas/entrenamiento-2.svg', mediaType: 'image', title: 'Hipertrofia Muscular', active: true },
            { mediaUrl: '/imagenes/inventadas/entrenamiento-3.svg', mediaType: 'image', title: 'Cardio HIIT', active: true },
            { mediaUrl: '/imagenes/inventadas/entrenamiento-4.svg', mediaType: 'image', title: 'Nutricion Deportiva', active: true },
            { mediaUrl: '/imagenes/inventadas/entrenamiento-5.svg', mediaType: 'image', title: 'Prep. Competicion', active: true },
            { mediaUrl: '/imagenes/inventadas/entrenamiento-6.svg', mediaType: 'image', title: 'Seguimiento Progreso', active: true },
        ],
        resultsEyebrow: 'HISTORIAS REALES',
        resultsTitle: 'Resultados',
        resultsSubtitle: 'Pasa el cursor sobre cada tarjeta para descubrir la historia detras del resultado.',
        transformaciones: [
            { name: 'Maria Garcia', periodo: '16 semanas', resultado: '-18 kg' },
            { name: 'Carlos Martinez', periodo: '20 semanas', resultado: '+12 kg musculo' },
            { name: 'Laura Perez', periodo: '12 semanas', resultado: '1er puesto' },
        ],
        resultados: [
            { name: 'Maria Garcia', metric: '-18 kg', period: 'en 4 meses', label: 'Perdida de peso', achievement: 'De 78 kg a 60 kg.', active: true },
            { name: 'Carlos Martinez', metric: '+12 kg', period: 'masa muscular', label: 'Hipertrofia', achievement: 'Programa de hipertrofia progresivo.', active: true },
            { name: 'Laura Perez', metric: '1er', period: 'puesto competicion', label: 'Competicion', achievement: 'Preparacion completa para competicion.', active: true },
            { name: 'Ana Rodriguez', metric: '100%', period: 'objetivo cumplido', label: 'Definicion', achievement: 'Programa de definicion y tonificacion.', active: true },
        ],
        galleryEyebrow: 'FOCUS CLUB',
        galleryTitle: 'Galeria',
        gallerySubtitle: '',
    },
    contacto: {
        heroEyebrow: 'CONTACTO',
        heroTitle: 'Hablamos?',
        heroSubtitle: 'Estamos aqui para responder tus preguntas y ayudarte a comenzar tu transformacion.',
        cards: [
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
        ],
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
        subjects: ['Informacion general', 'Entrenamiento personal', 'Fisioterapia', 'Pilates', 'Nutricion', 'Otro'],
        submitText: 'Enviar Mensaje',
        successTitle: 'Mensaje enviado',
        successMessage: 'Te responderemos lo antes posible.',
        mapUrl: 'https://maps.google.com/maps?q=C.+de+Pe%C3%B1aranda+de+Bracamonte+69+Local+4,Villa+de+Vallecas,28051+Madrid&output=embed',
    },
    servicesTitle: 'Servicios Especializados',
    servicesSubtitle: 'Programas disenados para atletas y personas que buscan la excelencia fisica',
    servicesEyebrow: 'NUESTROS SERVICIOS',
    servicesFaqsTitle: 'Preguntas Frecuentes',
    servicesFaqs: [
        { question: 'Cual es la duracion recomendada para una primera sesion?', answer: 'Recomendamos sesiones de 60 minutos para poder realizar una evaluacion completa y entender tus objetivos.' },
        { question: 'Necesito tener experiencia previa?', answer: 'No, nuestros programas estan disenados para todos los niveles, desde principiantes hasta atletas avanzados.' },
        { question: 'Como funciona el bono de entrenamiento?', answer: 'El bono mensual se adquiere directamente en el gimnasio.' },
        { question: 'Cual es la politica de cancelacion?', answer: 'Pedimos al menos 24 horas de antelacion para cualquier cambio o cancelacion sin coste.' },
    ],
    testimonialsEyebrow: 'TESTIMONIOS',
    testimonialsTitle: 'Historias de Transformacion',
    ctaTitle: 'Comienza tu transformacion hoy',
    ctaSubtitle: 'Reserva tu valoracion inicial gratuita y descubre como podemos ayudarte a alcanzar tus objetivos.',
    ctaButtonText: 'Solicitar Cita',
    ctaButtonLink: '/portal',
    footerText: 'Focus Club Vallecas - Centro premium de entrenamiento personal',
    phone: '+34 689 93 33 39',
    whatsapp: '+34 689 93 33 39',
    email: 'infofocusclub2026@gmail.com',
    address: 'C. de Penaranda de Bracamonte, 69, Local 4, Villa de Vallecas, 28051 Madrid',
    socialInstagram: 'https://www.instagram.com/focus_club_vallecas/',
    socialFacebook: '',
    socialTwitter: '',
};

// Hook para leer el CMS
export function useCMS() {
    const [cmsContent, setCmsContent] = useState<CMSContent>(defaultCMS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getSiteContent()
            .then((data) => { if (data) setCmsContent(data); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    return { cmsContent, loading, setCmsContent };
}

// Hook para leer servicios
export function useServices() {
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getServices()
            .then(setServices)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    return { services, loading, setServices };
}

// Hook para leer testimonios (publicos: solo aprobados)
export function useTestimonials(onlyApproved = true) {
    const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetcher = onlyApproved ? getApprovedTestimonials : getTestimonials;
        fetcher()
            .then(setTestimonials)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [onlyApproved]);

    return { testimonials, loading, setTestimonials };
}
