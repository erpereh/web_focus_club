'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Clock, CheckCircle, ArrowRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useServices, useCMS } from '@/hooks/useFirestore';

const DEFAULT_FAQS = [
  { question: '¿Cuál es la duración recomendada para una primera sesión?', answer: 'Recomendamos sesiones de 60 minutos para poder realizar una evaluación completa y entender tus objetivos.' },
  { question: '¿Necesito tener experiencia previa?', answer: 'No, nuestros programas están diseñados para todos los niveles, desde principiantes hasta atletas avanzados.' },
  { question: '¿Cómo funciona el bono de entrenamiento?', answer: 'El bono mensual se adquiere directamente en el gimnasio. Incluye 1 sesión de 1 hora semanal o 2 sesiones de 30 minutos, adaptándose a tu disponibilidad.' },
  { question: '¿Cuál es la política de cancelación?', answer: 'Pedimos al menos 24 horas de antelación para cualquier cambio o cancelación sin coste.' },
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

export default function ServiciosPage() {
  const { services } = useServices();
  const { cmsContent } = useCMS();

  const activeServices = services.filter(s => s.active !== false);
  const faqs = cmsContent.servicesFaqs?.length ? cmsContent.servicesFaqs : DEFAULT_FAQS;

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
              {cmsContent.servicesEyebrow ?? 'Nuestros Servicios'}
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mt-3 mb-6">
              {cmsContent.servicesTitle}
            </h1>
            <div className="line-accent mx-auto mb-4" />
            <p className="text-[var(--color-text-secondary)] text-lg">
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
            {activeServices.map((service) => (
              <motion.div key={service.id} id={service.id} variants={itemVariants}>
                <GlassCard className="h-full group">
                  <div className="flex flex-col md:flex-row gap-6">
                    <div className="flex-shrink-0">
                      <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-dim)] flex items-center justify-center group-hover:shadow-glow transition-shadow">
                        <DynamicIcon name={service.icon ?? 'Dumbbell'} className="w-8 h-8 text-[var(--color-accent-val)]" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-2xl font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-val)] transition-colors mb-3">
                        {service.title}
                      </h2>
                      <p className="text-[var(--color-text-secondary)] mb-4">
                        {service.description}
                      </p>
                      <div className="flex items-center gap-4 text-sm mb-4">
                        <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                          <Clock className="w-4 h-4 text-[var(--color-accent-val)]" />
                          {service.duration}
                        </span>
                        {service.price && (
                          <span className="text-[var(--color-accent-val)] font-medium">{service.price}</span>
                        )}
                      </div>
                      {service.features && service.features.length > 0 && (
                        <div className="space-y-2 mb-6">
                          {service.features.map((feature, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-[var(--color-accent-val)] flex-shrink-0" />
                              <span className="text-[var(--color-text-primary)] text-sm">{feature}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <Link href={service.ctaLink ?? '/portal'}>
                        <PremiumButton
                          variant="outline"
                          size="sm"
                          icon={<ArrowRight className="w-4 h-4" />}
                          iconPosition="right"
                        >
                          {service.ctaText ?? 'Reservar'}
                        </PremiumButton>
                      </Link>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
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
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)]">
              {cmsContent.servicesFaqsTitle ?? 'Preguntas Frecuentes'}
            </h2>
            <div className="line-accent mx-auto mt-3" />
          </motion.div>

          <div className="max-w-2xl mx-auto space-y-4">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{faq.question}</h3>
                  <p className="text-[var(--color-text-secondary)] text-sm">{faq.answer}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
