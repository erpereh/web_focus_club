'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Clock, CheckCircle, ArrowRight, Dumbbell, Activity, Heart, Apple } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { useServices, useCMS } from '@/hooks/useFirestore';

const serviceIcons = [Dumbbell, Activity, Heart, Apple];

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

export default function ServiciosPage() {
  const { services } = useServices();
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
              Nuestros Servicios
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-ivory mt-3 mb-6">
              {cmsContent.servicesTitle}
            </h1>
            <p className="text-muted-foreground text-lg">
              {cmsContent.servicesSubtitle}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <motion.div
            className="grid md:grid-cols-2 gap-8"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {services.map((service, index) => {
              const Icon = serviceIcons[index] || Dumbbell;
              return (
                <motion.div key={service.id} id={service.id} variants={itemVariants}>
                  <GlassCard className="h-full group">
                    <div className="flex flex-col md:flex-row gap-6">
                      {/* Icon */}
                      <div className="flex-shrink-0">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/10 flex items-center justify-center group-hover:shadow-glow transition-shadow">
                          <Icon className="w-8 h-8 text-accent" />
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <h2 className="text-2xl font-bold text-ivory group-hover:text-accent transition-colors">
                            {service.title}
                          </h2>
                          <span className="text-accent font-semibold text-lg">
                            {service.price}
                          </span>
                        </div>

                        <p className="text-muted-foreground mb-4">
                          {service.description}
                        </p>

                        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
                          <Clock className="w-4 h-4 text-accent" />
                          <span>Duración: {service.duration}</span>
                        </div>

                        {service.features && (
                          <div className="space-y-2 mb-6">
                            {service.features.map((feature, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
                                <span className="text-ivory text-sm">{feature}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <Link href="/solicitar-cita">
                          <PremiumButton
                            variant="outline"
                            size="sm"
                            icon={<ArrowRight className="w-4 h-4" />}
                            iconPosition="right"
                          >
                            Reservar
                          </PremiumButton>
                        </Link>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <motion.div
            className="max-w-3xl mx-auto text-center glass-card rounded-3xl p-6 md:p-12"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-ivory mb-4">
              ¿No sabes qué servicio elegir?
            </h2>
            <p className="text-muted-foreground mb-8">
              Reserva una consulta gratuita y te ayudaremos a encontrar el programa perfecto para ti.
            </p>
            <Link href="/solicitar-cita">
              <PremiumButton variant="cta" size="lg" icon={<ArrowRight className="w-5 h-5" />} iconPosition="right">
                Consulta Gratuita
              </PremiumButton>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-ivory">Preguntas Frecuentes</h2>
          </motion.div>

          <div className="max-w-2xl mx-auto space-y-4">
            {[
              {
                q: '¿Cuál es la duración recomendada para una primera sesión?',
                a: 'Recomendamos sesiones de 60 minutos para poder realizar una evaluación completa y entender tus objetivos.',
              },
              {
                q: '¿Necesito tener experiencia previa?',
                a: 'No, nuestros programas están diseñados para todos los niveles, desde principiantes hasta atletas avanzados.',
              },
              {
                q: '¿Puedo combinar diferentes servicios?',
                a: '¡Por supuesto! Muchos de nuestros clientes combinan entrenamiento personal con fisioterapia o pilates para resultados óptimos.',
              },
              {
                q: '¿Cuál es la política de cancelación?',
                a: 'Pedimos al menos 24 horas de antelación para cualquier cambio o cancelación sin coste.',
              },
            ].map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold text-ivory mb-2">{faq.q}</h3>
                  <p className="text-muted-foreground text-sm">{faq.a}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
