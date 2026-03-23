/**
 * Script de migración a producción — Focus Club Vallecas
 * Proyecto destino: focus-club-f73b8
 *
 * Usa Firebase Admin SDK (Service Account) para crear todas las colecciones
 * necesarias en el nuevo proyecto de producción.
 *
 * Ejecutar con: node scripts/seed-production.js
 *
 * Colecciones que crea:
 *   1. site_content   — CMS completo (doc 'main')
 *   2. services        — 4 servicios
 *   3. testimonials    — 3 testimonios aprobados
 *   4. users           — placeholder admin (se completará al registrarse)
 *   5. appointments    — estructura ejemplo (se borra tras verificar)
 *   6. blocked_slots   — vacía (doc placeholder temporal)
 *   7. slot_occupancy  — vacía (doc placeholder temporal)
 *   8. activity_logs   — vacía (doc placeholder temporal)
 */

const admin = require('firebase-admin');
const path = require('path');

// ============================================================
// INICIALIZACIÓN ADMIN SDK
// ============================================================

const serviceAccount = require(
    path.resolve(__dirname, '..', 'focus-club-f73b8-firebase-adminsdk-fbsvc-3355d90550.json')
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'focus-club-f73b8',
});

const db = admin.firestore();

// ============================================================
// DATOS DE SEED
// ============================================================

const siteContent = {
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
        bio: 'Con más de 20 años de experiencia en el mundo del fitness de competición, Sandra Andújar es una referencia en entrenamiento de hipertrofia y preparación física de élite. Jueza internacional certificada y preparadora de campeones, su metodología combina la ciencia más avanzada con una pasión inquebrantable por la excelencia.',
        experience: '20+ años',
        achievements: [
            'Jueza Internacional de Fitness',
            'Preparadora de +50 campeones',
            '15+ competiciones internacionales',
            'Premio Nacional de Excelencia 2020',
        ],
        certifications: [
            'Licenciatura en Ciencias de la Actividad Física y el Deporte',
            'Especialización en Hipertrofia y Fisicoculturismo',
            'Certificación como Jueza Internacional de Fitness',
            'Master en Alto Rendimiento Deportivo',
            'Especialista en Nutrición Deportiva para Competición',
            'Preparadora de Atletas de Élite',
        ],
        timeline: [
            { year: '2003', title: 'Inicio en el Fitness de Competición', description: 'Comienza su especialización en entrenamiento de hipertrofia y preparación física para atletas.' },
            { year: '2008', title: 'Primera Competición Internacional', description: 'Participa como competidora en campeonatos internacionales de fitness y fisicoculturismo.' },
            { year: '2012', title: 'Certificación como Jueza Internacional', description: 'Obtiene la certificación oficial como jueza de competiciones de fitness y bodybuilding.' },
            { year: '2015', title: 'Fundación de Focus Club Vallecas', description: 'Abre las puertas de su propio centro premium, materializando su visión de entrenamiento personalizado.' },
            { year: '2020', title: 'Reconocimiento a la Excelencia', description: 'Premio nacional a la mejor preparadora física en la categoría de fisicoculturismo.' },
            { year: '2024', title: 'Más de 20 Años de Experiencia', description: 'Dos décadas formando campeones y transformando vidas a través del entrenamiento premium.' },
        ],
        image: '/images/sandra-trainer.png',
    },
    centro: {
        title: 'El Centro',
        subtitle: 'Un espacio diseñado para tu transformación',
        description: 'Cada detalle ha sido pensado para ofrecerte la mejor experiencia. Un espacio exclusivo donde el entrenamiento personalizado, la privacidad y la calidad se fusionan.',
        features: [
            { icon: 'Sparkles', title: 'Equipamiento Premium', description: 'Marcas líderes en fitness y bienestar.' },
            { icon: 'Shield', title: 'Higiene Total', description: 'Protocolos estrictos de limpieza y desinfección.' },
            { icon: 'Zap', title: 'Tecnología Avanzada', description: 'Herramientas de análisis y seguimiento.' },
            { icon: 'Users', title: 'Espacio Exclusivo', description: 'Solo citas previas, sin aglomeraciones.' },
        ],
        gallery: ['/images/studio.png', '/images/hero-gym.png'],
        schedule: { weekdays: '7:00 - 21:00', saturday: '9:00 - 14:00' },
    },
    servicesTitle: 'Servicios Especializados',
    servicesSubtitle: 'Programas diseñados para atletas y personas que buscan la excelencia física',
    testimonialsTitle: 'Historias de Transformación',
    ctaTitle: 'Comienza tu transformación hoy',
    ctaSubtitle: 'Reserva tu valoración inicial gratuita y descubre cómo podemos ayudarte a alcanzar tus objetivos.',
    footerText: 'Focus Club Vallecas - Centro premium de entrenamiento personal y preparación para competición',
    phone: '+34 912 345 678',
    whatsapp: '+34 612 345 678',
    email: 'info@focusclubvallecas.com',
    address: 'Calle de la Ilusión 45, Vallecas, Madrid',
    socialInstagram: 'https://instagram.com/focusclubvallecas',
    socialFacebook: 'https://facebook.com/focusclubvallecas',
    socialTwitter: 'https://twitter.com/focusclubvallecas',
};

const services = [
    {
        title: 'Entrenamiento Personal',
        description: 'Programas personalizados de entrenamiento diseñados para alcanzar tus objetivos físicos con metodología científica y seguimiento individualizado.',
        duration: '60-90 min',
        price: 'Desde 60€',
        features: ['Plan personalizado', 'Seguimiento semanal', 'Ajustes continuos'],
        order: 1,
    },
    {
        title: 'Preparación para Competición',
        description: 'Preparación completa para atletas que buscan competir en fisicoculturismo, fitness o categorías afines a nivel nacional e internacional.',
        duration: 'Programa completo',
        price: 'Consultar',
        features: ['Periodización avanzada', 'Prep. poses y rutina', 'Acompañamiento en competencia'],
        order: 2,
    },
    {
        title: 'Nutrición y Recomposición',
        description: 'Planes nutricionales personalizados para optimizar tu composición corporal, ya sea para ganar masa muscular o reducir grasa.',
        duration: '45-60 min',
        price: 'Desde 50€',
        features: ['Plan alimenticio', 'Ajustes quincenales', 'Suplementación opcional'],
        order: 3,
    },
    {
        title: 'Valoración Inicial',
        description: 'Evaluación completa de tu condición física, composición corporal y objetivos para diseñar el programa perfecto para ti.',
        duration: '60 min',
        price: 'Gratis',
        features: ['Análisis corporal', 'Definición de objetivos', 'Propuesta personalizada'],
        order: 4,
    },
];

const testimonials = [
    {
        name: 'María García',
        role: 'Deportista amateur',
        content: 'Focus Club ha transformado mi forma de entender el entrenamiento. Sandra es una profesional excepcional que sabe adaptar cada sesión a mis necesidades.',
        rating: 5,
        approved: true,
    },
    {
        name: 'Carlos Rodríguez',
        role: 'Ejecutivo',
        content: 'Después de mi lesión de espalda, pensé que nunca volvería a entrenar. Gracias a la preparación física personalizada, estoy en mi mejor forma.',
        rating: 5,
        approved: true,
    },
    {
        name: 'Ana Martínez',
        role: 'Emprendedora',
        content: 'El ambiente premium y la atención personalizada hacen que cada visita sea especial. El método de Sandra ha cambiado mi postura y mi bienestar general.',
        rating: 5,
        approved: true,
    },
];

// ============================================================
// EJECUCIÓN
// ============================================================

const results = {};

async function seedCollection(name, fn) {
    try {
        await fn();
        results[name] = 'OK';
        console.log(`  [OK] ${name}`);
    } catch (err) {
        results[name] = `ERROR: ${err.message}`;
        console.error(`  [ERROR] ${name}: ${err.message}`);
    }
}

async function seed() {
    console.log('=== MIGRACIÓN A PRODUCCIÓN: focus-club-f73b8 ===\n');

    // 1. site_content
    await seedCollection('site_content', async () => {
        await db.collection('site_content').doc('main').set(siteContent);
    });

    // 2. services
    await seedCollection('services', async () => {
        for (const svc of services) {
            await db.collection('services').add(svc);
        }
    });

    // 3. testimonials
    await seedCollection('testimonials', async () => {
        for (const test of testimonials) {
            await db.collection('testimonials').add(test);
        }
    });

    // 4. users — doc placeholder para que la colección exista
    //    El admin real se creará cuando se registre en Auth + la app escriba su perfil
    await seedCollection('users', async () => {
        await db.collection('users').doc('_placeholder').set({
            _info: 'Placeholder para inicializar colección. Se puede borrar.',
            createdAt: new Date().toISOString(),
        });
    });

    // 5. appointments — doc ejemplo con TODOS los campos del esquema
    await seedCollection('appointments', async () => {
        await db.collection('appointments').doc('_schema_example').set({
            _info: 'Documento ejemplo con todos los campos del esquema. Se puede borrar.',
            userId: '_placeholder',
            name: 'Ejemplo',
            email: 'ejemplo@test.com',
            phone: '+34 600 000 000',
            serviceType: 'training',
            duration: '60',
            preferredSlots: [{ date: '2026-03-15', time: '10:00' }],
            reason: '',
            status: 'pending',
            approvedSlot: null,
            assignedTrainer: null,
            sessionType: null,
            currentAttendees: 0,
            createdAt: new Date().toISOString(),
            updatedAt: null,
        });
    });

    // 6. blocked_slots
    await seedCollection('blocked_slots', async () => {
        await db.collection('blocked_slots').doc('_placeholder').set({
            _info: 'Placeholder para inicializar colección. Se puede borrar.',
            createdAt: new Date().toISOString(),
        });
    });

    // 7. slot_occupancy
    await seedCollection('slot_occupancy', async () => {
        await db.collection('slot_occupancy').doc('_placeholder').set({
            _info: 'Placeholder para inicializar colección. Se puede borrar.',
            createdAt: new Date().toISOString(),
        });
    });

    // 8. activity_logs
    await seedCollection('activity_logs', async () => {
        await db.collection('activity_logs').doc('_placeholder').set({
            _info: 'Placeholder para inicializar colección. Se puede borrar.',
            action: 'seed_production',
            details: 'Migración inicial a producción',
            timestamp: new Date().toISOString(),
        });
    });

    // ============================================================
    // REPORTE FINAL
    // ============================================================
    console.log('\n=== REPORTE DE MIGRACIÓN ===\n');
    const allOk = Object.values(results).every(v => v === 'OK');
    for (const [col, status] of Object.entries(results)) {
        console.log(`  ${col.padEnd(20)} ${status}`);
    }
    console.log(`\n  Resultado global: ${allOk ? 'TODO OK' : 'HAY ERRORES'}`);

    if (allOk) {
        console.log('\n  Colecciones creadas: 8');
        console.log('  - site_content:   1 doc (main)');
        console.log('  - services:       4 docs');
        console.log('  - testimonials:   3 docs');
        console.log('  - users:          1 placeholder');
        console.log('  - appointments:   1 ejemplo con schema completo');
        console.log('  - blocked_slots:  1 placeholder');
        console.log('  - slot_occupancy: 1 placeholder');
        console.log('  - activity_logs:  1 log de migración');
        console.log('\n  Siguiente paso: firebase deploy --only firestore');
    }

    process.exit(allOk ? 0 : 1);
}

seed().catch((err) => {
    console.error('Error fatal durante la migración:', err);
    process.exit(1);
});
