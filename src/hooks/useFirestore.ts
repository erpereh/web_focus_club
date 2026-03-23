'use client';

import { useState, useEffect } from 'react';
import { getSiteContent, getServices, getApprovedTestimonials, getTestimonials } from '@/lib/firestore';
import type { CMSContent, Service, Testimonial } from '@/types';

// Datos por defecto (usados mientras se carga Firestore o si falla)
const defaultCMS: CMSContent = {
    heroTitle: 'Centro premium de bienestar y transformación física',
    heroSubtitle: 'Descubre un espacio exclusivo donde el entrenamiento personalizado, la preparación para competición y la nutrición se fusionan para alcanzar tus mejores resultados.',
    heroCTA: 'Solicitar Cita',
    heroImage: '/images/hero-gym.png',
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
    servicesTitle: 'Servicios Especializados',
    servicesSubtitle: 'Programas diseñados para atletas y personas que buscan la excelencia física',
    testimonialsTitle: 'Historias de Transformación',
    ctaTitle: 'Comienza tu transformación hoy',
    ctaSubtitle: 'Reserva tu valoración inicial gratuita y descubre cómo podemos ayudarte a alcanzar tus objetivos.',
    footerText: 'Focus Club Vallecas - Centro premium de entrenamiento personal',
    phone: '+34 912 345 678',
    whatsapp: '+34 612 345 678',
    email: 'info@focusclubvallecas.com',
    address: 'Calle de la Ilusión 45, Vallecas, Madrid',
    socialInstagram: '',
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
