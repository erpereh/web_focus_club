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
    title: 'Zona de Entrenamiento',
    description: 'Equipamiento de última generación en un espacio diseñado para maximizar tu rendimiento.',
    gradient: 'from-primary/40 to-forest-700/40',
  },
  {
    title: 'Sala de Fisioterapia',
    description: 'Camillas profesionales y equipos de electroterapia para tu recuperación óptima.',
    gradient: 'from-accent/30 to-accent/20',
  },
  {
    title: 'Estudio de Pilates',
    description: 'Reformers y equipamiento completo para sesiones de pilates de alta calidad.',
    gradient: 'from-forest-700/40 to-primary/30',
  },
  {
    title: 'Zona de Descanso',
    description: 'Espacio tranquilo para relajarte antes y después de tus sesiones.',
    gradient: 'from-primary/30 to-accent/20',
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
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent" />
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-accent text-sm font-medium uppercase tracking-wider">
              Nuestras Instalaciones
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-ivory mt-3 mb-6">
              {cmsContent?.centro?.title || 'El Centro'}
            </h1>
            <p className="text-muted-foreground text-lg">
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
            <p className="text-muted-foreground text-lg leading-relaxed">
              {cmsContent?.centro?.description || 'Un espacio diseñado para tu transformación personal.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Instalaciones / Zonas */}
      <section className="py-20 bg-obsidian">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-ivory mb-4">
              Nuestras Zonas
            </h2>
            <p className="text-muted-foreground">
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
                className="group relative rounded-3xl overflow-hidden glass-card p-2"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${facility.gradient} opacity-10 group-hover:opacity-20 transition-opacity duration-500`} />
                <div className="relative h-full flex flex-col p-6">
                  {/* Placeholder for images */}
                  <div className="w-full h-48 md:h-64 bg-muted/10 rounded-2xl mb-6 flex flex-col justify-center items-center border border-dashed border-border/50">
                    <p className="text-muted-foreground/50 text-sm font-medium uppercase tracking-wider">{facility.title}</p>
                    <p className="text-muted-foreground/30 text-xs mt-2">Próximamente fotos aquí</p>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-ivory mb-3 group-hover:text-accent transition-colors">{facility.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{facility.description}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-b from-transparent via-primary/5 to-transparent">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-ivory mb-4">
              ¿Por qué elegirnos?
            </h2>
            <p className="text-muted-foreground">
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
                      <div className="w-14 h-14 rounded-xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
                        <IconComponent className="w-7 h-7 text-accent" />
                      </div>
                      <h3 className="text-lg font-semibold text-ivory mb-2">{feature.title}</h3>
                      <p className="text-muted-foreground text-sm">{feature.description}</p>
                    </GlassCard>
                  </motion.div>
                );
              })
            ) : (
              features.map((feature, index) => (
                <motion.div key={index} variants={itemVariants}>
                  <GlassCard className="text-center h-full">
                    <div className="w-14 h-14 rounded-xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <feature.icon className="w-7 h-7 text-accent" />
                    </div>
                    <h3 className="text-lg font-semibold text-ivory mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground text-sm">{feature.description}</p>
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
              <span className="text-accent text-sm font-medium uppercase tracking-wider">
                Ubicación
              </span>
              <h2 className="text-3xl font-bold text-ivory mt-3 mb-6">
                Cómo llegar
              </h2>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ivory mb-1">Dirección</h3>
                    <p className="text-muted-foreground">{cmsContent?.address || 'Focus Club Vallecas'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ivory mb-1">Horario</h3>
                    <p className="text-muted-foreground">
                      {cmsContent?.centro?.schedule?.weekdays || 'Lunes a Viernes: 7:00 - 21:00'}<br />
                      {cmsContent?.centro?.schedule?.saturday || 'Sábados: 9:00 - 14:00'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ivory mb-1">Teléfono</h3>
                    <a href={`tel:${cmsContent?.phone}`} className="text-muted-foreground hover:text-accent transition-colors">
                      {cmsContent?.phone || 'Contactar'}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ivory mb-1">Email</h3>
                    <a href={`mailto:${cmsContent?.email}`} className="text-muted-foreground hover:text-accent transition-colors">
                      {cmsContent?.email || 'Email de contacto'}
                    </a>
                  </div>
                </div>
              </div>

              <Link href="/solicitar-cita" className="inline-block mt-8">
                <PremiumButton variant="cta" icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
                  Reservar Visita
                </PremiumButton>
              </Link>
            </motion.div>

            <motion.div
              className="rounded-3xl overflow-hidden glass-card p-2"
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="aspect-square md:aspect-[4/3] rounded-2xl bg-gradient-to-br from-primary/30 to-accent/10 flex items-center justify-center">
                <div className="text-center p-8">
                  <MapPin className="w-12 h-12 text-accent mx-auto mb-4" />
                  <p className="text-ivory font-semibold">Mapa interactivo</p>
                  <p className="text-muted-foreground text-sm mt-2">
                    {cmsContent?.address || 'Cargando ubicación...'}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
