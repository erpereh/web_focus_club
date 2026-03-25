'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { MapPin, Clock, Phone, Mail, ArrowRight, Sparkles, Shield, Zap, Users } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { useCMS } from '@/hooks/useFirestore';

const facilities = [
  {
    title: 'Entrada',
    description: 'Acceso exclusivo al centro, diseñado para que tu experiencia comience desde el primer paso.',
    image: '/imagenes/el_centro/entrada.jpeg',
    gradient: 'from-[var(--color-accent-dim)] to-[var(--color-accent-dim)]',
  },
  {
    title: 'Zona de Entrenamiento',
    description: 'Espacio equipado con todo lo necesario para tus sesiones de entrenamiento funcional y cardio.',
    image: '/imagenes/el_centro/gym1.jpeg',
    gradient: 'from-[var(--color-accent-dim)] to-[var(--color-accent-dim)]',
  },
  {
    title: 'Zona de Musculación',
    description: 'Área dedicada al trabajo de fuerza con maquinaria y pesos libres de calidad profesional.',
    image: '/imagenes/el_centro/gym3.jpeg',
    gradient: 'from-[var(--color-accent-dim)] to-[var(--color-accent-dim)]',
  },
  {
    title: 'Baño',
    description: 'Instalaciones limpias y bien equipadas para que puedas asearte cómodamente tras tu sesión.',
    image: '/imagenes/el_centro/baño.jpeg',
    gradient: 'from-[var(--color-accent-dim)] to-[var(--color-accent-dim)]',
  },
];

const features = [
  {
    icon: Sparkles,
    title: 'Equipamiento Premium',
    description: 'Marcas líderes en fitness y bienestar.',
  },
  {
    icon: Shield,
    title: 'Higiene Total',
    description: 'Protocolos estrictos de limpieza y desinfección.',
  },
  {
    icon: Zap,
    title: 'Tecnología Avanzada',
    description: 'Herramientas de análisis y seguimiento.',
  },
  {
    icon: Users,
    title: 'Espacio Exclusivo',
    description: 'Solo citas previas, sin aglomeraciones.',
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

export default function CentroPage() {
  const { cmsContent } = useCMS();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-accent-dim)] to-transparent" />
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="eyebrow">
              Nuestras Instalaciones
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mt-3 mb-6">
              {cmsContent?.centro?.title || 'El Centro'}
            </h1>
            <p className="text-[var(--color-text-secondary)] text-lg">
              {cmsContent?.centro?.subtitle || 'Un espacio diseñado para tu transformación.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Description */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <p className="text-[var(--color-text-secondary)] text-lg leading-relaxed">
              {cmsContent?.centro?.description || 'Un espacio diseñado para tu transformación personal.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Instalaciones / Zonas */}
      <section className="py-20 bg-[var(--color-bg-surface)]">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mb-4">
              Nuestras Zonas
            </h2>
            <div className="line-accent mx-auto" />
            <p className="text-[var(--color-text-secondary)] mt-4">
              Espacios pensados para cada etapa de tu entrenamiento
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {facilities.map((facility, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group relative rounded-3xl overflow-hidden card-glass p-2"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${facility.gradient} opacity-10 group-hover:opacity-20 transition-opacity duration-500`} />
                <div className="relative h-full flex flex-col p-6">
                  <div className="relative w-full h-48 md:h-64 rounded-2xl mb-6 overflow-hidden">
                    <Image
                      src={facility.image}
                      alt={facility.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-[var(--color-text-primary)] mb-3 group-hover:text-[var(--color-accent-val)] transition-colors">{facility.title}</h3>
                    <p className="text-[var(--color-text-secondary)] leading-relaxed">{facility.description}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-b from-transparent via-[var(--color-accent-dim)] to-transparent">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mb-4">
              ¿Por qué elegirnos?
            </h2>
            <div className="line-accent mx-auto" />
            <p className="text-[var(--color-text-secondary)] mt-4">
              Detalles que marcan la diferencia
            </p>
          </motion.div>

          <motion.div
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {(cmsContent?.centro?.features || []).length > 0 ? (
              cmsContent.centro.features.map((feature, index) => {
                const IconComponent = { Sparkles, Shield, Zap, Users }[feature.icon] || Sparkles;
                return (
                  <motion.div key={index} variants={itemVariants}>
                    <GlassCard className="text-center h-full">
                      <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center mx-auto mb-4">
                        <IconComponent className="w-7 h-7 text-[var(--color-accent-val)]" />
                      </div>
                      <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{feature.title}</h3>
                      <p className="text-[var(--color-text-secondary)] text-sm">{feature.description}</p>
                    </GlassCard>
                  </motion.div>
                );
              })
            ) : (
              features.map((feature, index) => (
                <motion.div key={index} variants={itemVariants}>
                  <GlassCard className="text-center h-full">
                    <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center mx-auto mb-4">
                      <feature.icon className="w-7 h-7 text-[var(--color-accent-val)]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{feature.title}</h3>
                    <p className="text-[var(--color-text-secondary)] text-sm">{feature.description}</p>
                  </GlassCard>
                </motion.div>
              ))
            )}
          </motion.div>
        </div>
      </section>

      {/* Location */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="eyebrow">
                Ubicación
              </span>
              <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3 mb-4">
                Cómo llegar
              </h2>
              <div className="line-accent mb-6" />

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Dirección</h3>
                    <a
                      href="https://maps.app.goo.gl/EHFk2xEh9xwHBaDKA"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors"
                    >
                      {cmsContent?.address || 'Focus Club Vallecas'}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Clock className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Horario</h3>
                    <p className="text-[var(--color-text-secondary)]">
                      {cmsContent?.centro?.schedule?.weekdays || 'Lunes a Viernes: 7:00 - 21:00'}<br />
                      {cmsContent?.centro?.schedule?.saturday || 'Sábados: 9:00 - 14:00'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Teléfono</h3>
                    <a href={`tel:${cmsContent?.phone}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors">
                      {cmsContent?.phone || 'Contactar'}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Email</h3>
                    <a href={`mailto:${cmsContent?.email}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors">
                      {cmsContent?.email || 'Email de contacto'}
                    </a>
                  </div>
                </div>
              </div>

              <Link href="/portal" className="inline-block mt-8">
                <PremiumButton variant="cta" icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
                  Reservar Visita
                </PremiumButton>
              </Link>
            </motion.div>

            <motion.div
              className="rounded-3xl overflow-hidden card-glass p-2"
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="relative aspect-square md:aspect-[4/3] rounded-2xl overflow-hidden">
                <iframe
                  src="https://maps.google.com/maps?q=C.+de+Pe%C3%B1aranda+de+Bracamonte+69+Local+4,Villa+de+Vallecas,28051+Madrid&output=embed"
                  className="absolute inset-0 w-full h-full"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Focus Club Vallecas — Calle de la Ilusión 45, Vallecas, Madrid"
                />
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
