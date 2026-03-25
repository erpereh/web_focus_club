'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { Award, Heart, Users, Target, ArrowRight, Calendar, CheckCircle, Trophy, Medal, Star } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { useCMS } from '@/hooks/useFirestore';

const timeline = [
  {
    year: '2003',
    title: 'Inicio en el Fitness de Competición',
    description: 'Comienza su especialización en entrenamiento de hipertrofia y preparación física para atletas.',
  },
  {
    year: '2008',
    title: 'Primera Competición Internacional',
    description: 'Participa como competidora en campeonatos internacionales de fitness y fisicoculturismo.',
  },
  {
    year: '2012',
    title: 'Certificación como Jueza Internacional',
    description: 'Obtiene la certificación oficial como jueza de competiciones de fitness y bodybuilding.',
  },
  {
    year: '2015',
    title: 'Fundación de Focus Club Vallecas',
    description: 'Abre las puertas de su propio centro premium, materializando su visión de entrenamiento personalizado.',
  },
  {
    year: '2020',
    title: 'Reconocimiento a la Excelencia',
    description: 'Premio nacional a la mejor preparadora física en la categoría de fisicoculturismo.',
  },
  {
    year: '2024',
    title: 'Más de 20 Años de Experiencia',
    description: 'Dos décadas formando campeones y transformando vidas a través del entrenamiento premium.',
  },
];

const achievements = [
  { icon: Trophy, value: '20+', label: 'Años de Experiencia' },
  { icon: Medal, value: '50+', label: 'Campeones Formados' },
  { icon: Star, value: '15+', label: 'Competiciones Internacionales' },
  { icon: Award, value: 'Jueza', label: 'Internacional Certificada' },
];

const certifications = [
  'Licenciatura en Ciencias de la Actividad Física y el Deporte',
  'Especialización en Hipertrofia y Fisicoculturismo',
  'Certificación como Jueza Internacional de Fitness',
  'Master en Alto Rendimiento Deportivo',
  'Especialista en Nutrición Deportiva para Competición',
  'Preparadora de Atletas de Élite',
];

const specialties = [
  {
    title: 'Hipertrofia Avanzada',
    description: 'Programas científicos para maximizar el desarrollo muscular con técnicas avanzadas.',
    icon: Target,
  },
  {
    title: 'Preparación para Competición',
    description: 'Acompañamiento completo para atletas que buscan competir a nivel nacional e internacional.',
    icon: Trophy,
  },
  {
    title: 'Recomposición Corporal',
    description: 'Estrategias personalizadas para perder grasa mientras se mantiene o aumenta la masa muscular.',
    icon: Medal,
  },
];

const values = [
  {
    icon: Heart,
    title: 'Dedicación Total',
    description: 'Cada cliente recibe atención personalizada y seguimiento constante.',
  },
  {
    icon: Target,
    title: 'Metodología Científica',
    description: 'Programas basados en evidencia científica y resultados medibles.',
  },
  {
    icon: Users,
    title: 'Comunidad de Campeones',
    description: 'Un entorno exclusivo donde cada miembro persigue la excelencia.',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function SandraPage() {
  const { cmsContent } = useCMS();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-accent-dim)] to-transparent" />
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="eyebrow">
                La experta detrás del proyecto
              </span>
              <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mt-3 mb-6">
                {cmsContent?.sandra?.name || 'Sandra Andújar'}
              </h1>
              <div className="line-accent mb-4" />
              <div className="text-[var(--color-text-secondary)] text-lg leading-relaxed mb-4 space-y-4">
                {cmsContent?.sandra?.bio ? (
                  cmsContent.sandra.bio.split('\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))
                ) : (
                  <>
                    <p>
                      Con más de <span className="text-[var(--color-accent-val)] font-semibold">20 años de experiencia</span> en el mundo del fitness de competición, Sandra Andújar es una referencia en entrenamiento de hipertrofia y preparación física de élite.
                    </p>
                    <p>
                      <span className="text-[var(--color-accent-val)] font-semibold">Jueza internacional certificada</span> y preparadora de campeones, su metodología combina la ciencia más avanzada con una pasión inquebrantable por la excelencia.
                    </p>
                  </>
                )}
              </div>

              {/* Achievements Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(cmsContent?.sandra?.achievements && cmsContent.sandra.achievements.length > 0 ? cmsContent.sandra.achievements : ['20+ Años', '50+ Atletas', '15+ Copas', 'Jueza Int.']).map((text, index) => {
                  const icons = [Trophy, Medal, Star, Award];
                  const Icon = icons[index % icons.length];
                  return (
                    <motion.div
                      key={index}
                      className="text-center p-4 rounded-xl bg-[var(--color-accent-dim)] border border-[var(--color-accent-border)]"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Icon className="w-6 h-6 text-[var(--color-accent-val)] mx-auto mb-2" />
                      <div className="text-sm font-bold text-[var(--color-text-primary)]">{text}</div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>

            <motion.div
              className="relative"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="rounded-3xl overflow-hidden glass-card p-2 max-w-md mx-auto">
                <div className="relative rounded-2xl overflow-hidden">
                  <Image
                    src="/imagenes/sandra.jpg"
                    alt="Sandra Andújar — Entrenadora personal y jueza internacional en Focus Club Vallecas"
                    width={600}
                    height={600}
                    className="w-full h-auto object-cover object-top"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-base)]/80 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-xs font-medium">
                        Jueza Internacional
                      </span>
                      <span className="px-3 py-1 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] text-xs font-medium">
                        +20 Años Experiencia
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Decorative elements */}
              <div className="absolute -top-8 -right-8 w-32 h-32 bg-[var(--color-accent-val)]/15 rounded-full blur-3xl" />
              <div className="absolute -bottom-8 -left-8 w-40 h-40 bg-[var(--color-accent-val)]/15 rounded-full blur-3xl" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="eyebrow">
              Filosofía de trabajo
            </span>
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3">
              Valores que nos definen
            </h2>
            <div className="line-accent mx-auto mt-3" />
          </motion.div>

          <motion.div
            className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {values.map((value, index) => (
              <motion.div key={index} variants={itemVariants}>
                <GlassCard className="text-center h-full">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-dim)] flex items-center justify-center mx-auto mb-4">
                    <value.icon className="w-8 h-8 text-[var(--color-accent-val)]" />
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">{value.title}</h3>
                  <p className="text-[var(--color-text-secondary)] text-sm">{value.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Timeline Section */}
      <section className="py-20 bg-gradient-to-b from-transparent via-[var(--color-accent-dim)] to-transparent">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="eyebrow">
              Trayectoria profesional
            </span>
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3">
              Un camino de dedicación
            </h2>
            <div className="line-accent mx-auto mt-3" />
          </motion.div>

          <div className="max-w-3xl mx-auto">
            {(cmsContent?.sandra?.timeline && cmsContent.sandra.timeline.length > 0 ? cmsContent.sandra.timeline : timeline).map((item, index) => (
              <motion.div
                key={index}
                className="relative pl-8 pb-12 last:pb-0"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                {/* Timeline line */}
                <div className="absolute left-0 top-2 bottom-0 w-px bg-gradient-to-b from-[var(--color-accent-val)] via-[var(--color-accent-val)] to-transparent" />

                {/* Timeline dot */}
                <div className="absolute left-0 top-2 -translate-x-1/2 w-4 h-4 rounded-full bg-[var(--color-accent-val)] shadow-emerald-glow" />

                <GlassCard className="ml-4">
                  <span className="text-[var(--color-accent-val)] font-semibold text-sm">{item.year}</span>
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mt-1 mb-2">{item.title}</h3>
                  <p className="text-[var(--color-text-secondary)] text-sm">{item.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Certifications Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="eyebrow">
                Formación académica
              </span>
              <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3 mb-3">
                Certificaciones y títulos
              </h2>
              <div className="line-accent mb-6" />
              <p className="text-[var(--color-text-secondary)] mb-8">
                Una formación continua y rigurosa que garantiza la máxima calidad en cada sesión.
              </p>
              <div className="space-y-3">
                {(cmsContent?.sandra?.certifications && cmsContent.sandra.certifications.length > 0 ? cmsContent.sandra.certifications : certifications).map((cert, index) => (
                  <motion.div
                    key={index}
                    className="flex items-start gap-3"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <CheckCircle className="w-5 h-5 text-[var(--color-accent-val)] flex-shrink-0 mt-0.5" />
                    <span className="text-[var(--color-text-primary)] text-sm">{cert}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <GlassCard className="p-8">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-accent-val)] to-emerald-bright mx-auto mb-6 flex items-center justify-center">
                    <Award className="w-10 h-10 text-[var(--color-bg-base)]" />
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
                    ¿Listo para empezar?
                  </h3>
                  <p className="text-[var(--color-text-secondary)] text-sm mb-6">
                    Reserva tu primera consulta gratuita y descubre cómo podemos ayudarte.
                  </p>
                  <Link href="/portal">
                    <PremiumButton variant="cta" icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
                      Reservar Cita
                    </PremiumButton>
                  </Link>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
