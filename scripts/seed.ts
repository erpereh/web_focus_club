/**
 * Script de inicialización (seed) de Firestore para Focus Club Vallecas
 * Ejecutar con: npx tsx scripts/seed.ts
 *
 * Inyecta:
 * - site_content/main — Textos del CMS completo
 * - services/* — 4 servicios iniciales
 * - testimonials/* — 3 testimonios aprobados
 * - users/ADMIN_PLACEHOLDER — Pre-registro de admin
 */

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, addDoc, getDocs } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAybBtOavxRoZ2unWpl5lVxFtOyxT8KksI",
    authDomain: "focus-club-252dc.firebaseapp.com",
    projectId: "focus-club-252dc",
    storageBucket: "focus-club-252dc.firebasestorage.app",
    messagingSenderId: "674130559920",
    appId: "1:674130559920:web:54b75c668f43d141bb8c75",
    measurementId: "G-1K4PYB6M5H",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============================================================
// DATOS DE SEED
// ============================================================

const ADMIN_EMAIL = "david.perez.iglesias2004@gmail.com";

const siteContent = {
    heroTitle: "Centro premium de bienestar y transformación física",
    heroSubtitle: "Descubre un espacio exclusivo donde el entrenamiento personalizado, la preparación para competición y la nutrición se fusionan para alcanzar tus mejores resultados.",
    heroCTA: "Solicitar Cita",
    heroImage: "/images/hero-gym.png",
    aboutTitle: "Sandra Andújar",
    aboutText: "Con más de 20 años de experiencia en el mundo del fitness de competición, Sandra Andújar es una referencia en entrenamiento de hipertrofia y preparación física de élite.",
    aboutImage: "/images/sandra-trainer.png",
    sandra: {
        name: "Sandra Andújar",
        title: "Jueza Internacional & Preparadora de Campeones",
        subtitle: "La experta detrás del proyecto",
        bio: "Con más de 20 años de experiencia en el mundo del fitness de competición, Sandra Andújar es una referencia en entrenamiento de hipertrofia y preparación física de élite. Jueza internacional certificada y preparadora de campeones, su metodología combina la ciencia más avanzada con una pasión inquebrantable por la excelencia.",
        experience: "20+ años",
        achievements: [
            "Jueza Internacional de Fitness",
            "Preparadora de +50 campeones",
            "15+ competiciones internacionales",
            "Premio Nacional de Excelencia 2020",
        ],
        certifications: [
            "Licenciatura en Ciencias de la Actividad Física y el Deporte",
            "Especialización en Hipertrofia y Fisicoculturismo",
            "Certificación como Jueza Internacional de Fitness",
            "Master en Alto Rendimiento Deportivo",
            "Especialista en Nutrición Deportiva para Competición",
            "Preparadora de Atletas de Élite",
        ],
        timeline: [
            { year: "2003", title: "Inicio en el Fitness de Competición", description: "Comienza su especialización en entrenamiento de hipertrofia y preparación física para atletas." },
            { year: "2008", title: "Primera Competición Internacional", description: "Participa como competidora en campeonatos internacionales de fitness y fisicoculturismo." },
            { year: "2012", title: "Certificación como Jueza Internacional", description: "Obtiene la certificación oficial como jueza de competiciones de fitness y bodybuilding." },
            { year: "2015", title: "Fundación de Focus Club Vallecas", description: "Abre las puertas de su propio centro premium, materializando su visión de entrenamiento personalizado." },
            { year: "2020", title: "Reconocimiento a la Excelencia", description: "Premio nacional a la mejor preparadora física en la categoría de fisicoculturismo." },
            { year: "2024", title: "Más de 20 Años de Experiencia", description: "Dos décadas formando campeones y transformando vidas a través del entrenamiento premium." },
        ],
        image: "/images/sandra-trainer.png",
    },
    centro: {
        title: "El Centro",
        subtitle: "Un espacio diseñado para tu transformación",
        description: "Cada detalle ha sido pensado para ofrecerte la mejor experiencia. Un espacio exclusivo donde el entrenamiento personalizado, la privacidad y la calidad se fusionan.",
        features: [
            { icon: "Sparkles", title: "Equipamiento Premium", description: "Marcas líderes en fitness y bienestar." },
            { icon: "Shield", title: "Higiene Total", description: "Protocolos estrictos de limpieza y desinfección." },
            { icon: "Zap", title: "Tecnología Avanzada", description: "Herramientas de análisis y seguimiento." },
            { icon: "Users", title: "Espacio Exclusivo", description: "Solo citas previas, sin aglomeraciones." },
        ],
        gallery: ["/images/studio.png", "/images/hero-gym.png"],
        schedule: { weekdays: "7:00 - 21:00", saturday: "9:00 - 14:00" },
    },
    servicesTitle: "Servicios Especializados",
    servicesSubtitle: "Programas diseñados para atletas y personas que buscan la excelencia física",
    testimonialsTitle: "Historias de Transformación",
    ctaTitle: "Comienza tu transformación hoy",
    ctaSubtitle: "Reserva tu valoración inicial gratuita y descubre cómo podemos ayudarte a alcanzar tus objetivos.",
    footerText: "Focus Club Vallecas - Centro premium de entrenamiento personal y preparación para competición",
    phone: "+34 912 345 678",
    whatsapp: "+34 612 345 678",
    email: "info@focusclubvallecas.com",
    address: "Calle de la Ilusión 45, Vallecas, Madrid",
    socialInstagram: "https://instagram.com/focusclubvallecas",
    socialFacebook: "https://facebook.com/focusclubvallecas",
    socialTwitter: "https://twitter.com/focusclubvallecas",
};

const services = [
    {
        title: "Entrenamiento Personal",
        description: "Programas personalizados de entrenamiento diseñados para alcanzar tus objetivos físicos con metodología científica y seguimiento individualizado.",
        duration: "60-90 min",
        price: "Desde 60€",
        features: ["Plan personalizado", "Seguimiento semanal", "Ajustes continuos"],
        order: 1,
    },
    {
        title: "Preparación para Competición",
        description: "Preparación completa para atletas que buscan competir en fisicoculturismo, fitness o categorías afines a nivel nacional e internacional.",
        duration: "Programa completo",
        price: "Consultar",
        features: ["Periodización avanzada", "Prep. poses y rutina", "Acompañamiento en competencia"],
        order: 2,
    },
    {
        title: "Nutrición y Recomposición",
        description: "Planes nutricionales personalizados para optimizar tu composición corporal, ya sea para ganar masa muscular o reducir grasa.",
        duration: "45-60 min",
        price: "Desde 50€",
        features: ["Plan alimenticio", "Ajustes quincenales", "Suplementación opcional"],
        order: 3,
    },
    {
        title: "Valoración Inicial",
        description: "Evaluación completa de tu condición física, composición corporal y objetivos para diseñar el programa perfecto para ti.",
        duration: "60 min",
        price: "Gratis",
        features: ["Análisis corporal", "Definición de objetivos", "Propuesta personalizada"],
        order: 4,
    },
];

const testimonials = [
    {
        name: "María García",
        role: "Deportista amateur",
        content: "Focus Club ha transformado mi forma de entender el entrenamiento. Sandra es una profesional excepcional que sabe adaptar cada sesión a mis necesidades.",
        rating: 5,
        approved: true,
    },
    {
        name: "Carlos Rodríguez",
        role: "Ejecutivo",
        content: "Después de mi lesión de espalda, pensé que nunca volvería a entrenar. Gracias a la preparación física personalizada, estoy en mi mejor forma.",
        rating: 5,
        approved: true,
    },
    {
        name: "Ana Martínez",
        role: "Emprendedora",
        content: "El ambiente premium y la atención personalizada hacen que cada visita sea especial. El método de Sandra ha cambiado mi postura y mi bienestar general.",
        rating: 5,
        approved: true,
    },
];

// ============================================================
// EJECUCIÓN
// ============================================================

async function seed() {
    console.log("🌱 Iniciando seed de Firestore para Focus Club Vallecas...\n");

    // 1. site_content/main
    console.log("📝 Creando site_content/main...");
    await setDoc(doc(db, "site_content", "main"), siteContent);
    console.log("   ✅ CMS completo inyectado\n");

    // 2. services
    console.log("💪 Creando servicios...");
    const existingServices = await getDocs(collection(db, "services"));
    if (existingServices.empty) {
        for (const svc of services) {
            await addDoc(collection(db, "services"), svc);
            console.log(`   ✅ ${svc.title}`);
        }
    } else {
        console.log("   ⚠️  Ya existen servicios, omitido");
    }
    console.log();

    // 3. testimonials
    console.log("⭐ Creando testimonios...");
    const existingTestimonials = await getDocs(collection(db, "testimonials"));
    if (existingTestimonials.empty) {
        for (const test of testimonials) {
            await addDoc(collection(db, "testimonials"), test);
            console.log(`   ✅ ${test.name}`);
        }
    } else {
        console.log("   ⚠️  Ya existen testimonios, omitido");
    }
    console.log();

    console.log("🎉 ¡Seed completado! La base de datos de Focus Club está lista.");
    console.log("   → site_content: 1 documento");
    console.log(`   → services: ${services.length} documentos`);
    console.log(`   → testimonials: ${testimonials.length} documentos`);

    process.exit(0);
}

seed().catch((err) => {
    console.error("❌ Error durante el seed:", err);
    process.exit(1);
});
