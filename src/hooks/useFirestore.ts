'use client';

import { useState, useEffect } from 'react';
import { getSiteContent, getServices, getApprovedTestimonials, getTestimonials } from '@/lib/firestore';
import type { CMSContent, Service, Testimonial } from '@/types';

// Datos por defecto (usados mientras se carga Firestore o si falla)
export const defaultCMS: CMSContent = {
    heroTitle: 'Centro premium de bienestar y transformación física',
    heroSubtitle: 'Descubre un espacio exclusivo donde el entrenamiento personalizado, la preparación para competición y la nutrición se fusionan para alcanzar tus mejores resultados.',
    heroCTA: 'Solicitar Cita',
    heroImage: '/images/hero-gym.png',
    heroEyebrow: 'Bienvenido a Focus Club Vallecas',
    heroTitleStart: 'Transforma Tu',
    heroTitleHighlight: 'Cuerpo y Mente',
    heroCtaPrimaryLink: '/portal',
    heroCtaSecondaryText: 'Ver Servicios',
    heroCtaSecondaryLink: '/servicios',
    heroStats: [
        { icon: 'Award', value: '15+', label: 'Años de Experiencia' },
        { icon: 'Users', value: '500+', label: 'Clientes Satisfechos' },
        { icon: 'Dumbbell', value: '4', label: 'Servicios Premium' },
        { icon: 'Heart', value: '100%', label: 'Compromiso' },
    ],
    aboutTitle: 'Sandra Andújar',
    aboutText: 'Con más de 20 años de experiencia en el mundo del fitness de competición, Sandra Andújar es una referencia en entrenamiento de hipertrofia y preparación física de élite.',
    aboutImage: '/images/sandra-trainer.png',
    sandra: {
        name: 'Sandra Andújar',
        title: 'Jueza Internacional & Preparadora de Campeones',
        subtitle: 'La experta detrás del proyecto',
        bio: 'Con más de 20 años de experiencia en el mundo del fitness de competición, Sandra Andújar es una referencia en entrenamiento de hipertrofia y preparación física de élite.',
        experience: '20+ años',
        achievements: [],
        certifications: [],
        timeline: [],
        image: '/images/sandra-trainer.png',
    },
    centro: {
        title: 'El Centro',
        subtitle: 'Un espacio diseñado para tu transformación',
        description: '',
        features: [],
        gallery: [],
        schedule: { weekdays: '7:00 - 21:00', saturday: '9:00 - 14:00' },
    },
    galeria: {
        heroTitle: 'Galería Focus Club Vallecas',
        heroSubtitle: 'Resultados reales, historias de transformación auténticas.',
        stats: [
            { value: 200, suffix: '+', label: 'Clientes transformados' },
            { value: 20, suffix: ' años', label: 'De experiencia' },
            { value: 100, suffix: '%', label: 'Compromiso' },
        ],
        transformaciones: [
            { name: 'María García', periodo: '16 semanas', resultado: '-18 kg' },
            { name: 'Carlos Martínez', periodo: '20 semanas', resultado: '+12 kg músculo' },
            { name: 'Laura Pérez', periodo: '12 semanas', resultado: '1er puesto' },
        ],
        resultados: [
            { name: 'María García', stat: '-18 kg', statLabel: 'en 4 meses', tag: 'Pérdida de peso', story: '"Nunca pensé que podría estar así de bien. Sandra me cambió la vida, no solo el cuerpo. El método es brutal."', detail: 'De 78 kg a 60 kg. Cambio total de composición corporal con plan de nutrición incluido.' },
            { name: 'Carlos Martínez', stat: '+12 kg', statLabel: 'masa muscular', tag: 'Hipertrofia', story: '"Llevaba años en el gimnasio sin avanzar. En 6 meses con Sandra conseguí más que en 4 años solo."', detail: 'Programa de hipertrofia progresivo con periodización avanzada y seguimiento semanal.' },
            { name: 'Laura Pérez', stat: '1er', statLabel: 'puesto competición', tag: 'Competición', story: '"Preparar mi primera competición con Sandra fue la mejor decisión. Técnica, nutrición y mentalidad: 10/10."', detail: 'Preparación completa para competición de fitness en 5 meses. Primera vez en escenario.' },
            { name: 'Ana Rodríguez', stat: '100%', statLabel: 'objetivo cumplido', tag: 'Definición', story: '"Entré buscando definición y salí con un estilo de vida completamente nuevo. Increíble equipo."', detail: 'Programa de definición y tonificación de 3 meses con resultados visibles desde la semana 4.' },
        ],
    },
    servicesTitle: 'Servicios Especializados',
    servicesSubtitle: 'Programas diseñados para atletas y personas que buscan la excelencia física',
    testimonialsTitle: 'Historias de Transformación',
    ctaTitle: 'Comienza tu transformación hoy',
    ctaSubtitle: 'Reserva tu valoración inicial gratuita y descubre cómo podemos ayudarte a alcanzar tus objetivos.',
    footerText: 'Focus Club Vallecas - Centro premium de entrenamiento personal',
    phone: '+34 689 93 33 39',
    whatsapp: '+34 689 93 33 39',
    email: 'infofocusclub2026@gmail.com',
    address: 'C. de Peñaranda de Bracamonte, 69, Local 4, Villa de Vallecas, 28051 Madrid',
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

// Hook para leer testimonios (públicos: solo aprobados)
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
