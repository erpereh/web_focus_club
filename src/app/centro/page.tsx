'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { MapPin, Clock, Phone, Mail, ArrowRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useCMS } from '@/hooks/useFirestore';
import { normalizeCentroConfig } from '@/lib/firestore';

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
  const centro = normalizeCentroConfig(cmsContent?.centro);
  const zonas = (centro.zonas || []).filter((zona) => zona.active !== false);

  return (
    <div className="min-h-screen">
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-accent-dim)] to-transparent" />
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="eyebrow">{centro.eyebrow}</span>
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mt-3 mb-6">
              {centro.title}
            </h1>
            <p className="text-[var(--color-text-secondary)] text-lg">{centro.subtitle}</p>
          </motion.div>
        </div>
      </section>

      <section className="py-12">
        <div className="container mx-auto px-4">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <p className="text-[var(--color-text-secondary)] text-lg leading-relaxed">{centro.description}</p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-[var(--color-bg-surface)]">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mb-4">
              {centro.zonasTitle}
            </h2>
            <div className="line-accent mx-auto" />
            <p className="text-[var(--color-text-secondary)] mt-4">{centro.zonasSubtitle}</p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {zonas.map((zona, index) => (
              <motion.div
                key={`${zona.title}-${index}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group relative rounded-3xl overflow-hidden card-glass p-2"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-accent-dim)] to-[var(--color-accent-dim)] opacity-10 group-hover:opacity-20 transition-opacity duration-500" />
                <div className="relative h-full flex flex-col p-6">
                  <div className="relative w-full h-48 md:h-64 rounded-2xl mb-6 overflow-hidden">
                    <Image
                      src={zona.image}
                      alt={zona.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-[var(--color-text-primary)] mb-3 group-hover:text-[var(--color-accent-val)] transition-colors">
                      {zona.title}
                    </h3>
                    <p className="text-[var(--color-text-secondary)] leading-relaxed">{zona.description}</p>
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
              {centro.featuresTitle}
            </h2>
            <div className="line-accent mx-auto" />
            <p className="text-[var(--color-text-secondary)] mt-4">{centro.featuresSubtitle}</p>
          </motion.div>

          <motion.div
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {centro.features.map((feature, index) => (
              <motion.div key={`${feature.title}-${index}`} variants={itemVariants}>
                <GlassCard className="text-center h-full">
                  <div className="w-14 h-14 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center mx-auto mb-4">
                    <DynamicIcon name={feature.icon} className="w-7 h-7 text-[var(--color-accent-val)]" />
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{feature.title}</h3>
                  <p className="text-[var(--color-text-secondary)] text-sm">{feature.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="eyebrow">{centro.locationEyebrow}</span>
              <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3 mb-4">
                {centro.locationTitle}
              </h2>
              <div className="line-accent mb-6" />

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Direccion</h3>
                    <p className="text-[var(--color-text-secondary)]">{centro.address}</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Clock className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Horario</h3>
                    <p className="text-[var(--color-text-secondary)]">{centro.schedule}</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Telefono</h3>
                    <a href={`tel:${centro.phone}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors">
                      {centro.phone}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-[var(--color-accent-val)]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">Email</h3>
                    <a href={`mailto:${centro.email}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors">
                      {centro.email}
                    </a>
                  </div>
                </div>
              </div>

              <Link href={centro.ctaLink} className="inline-block mt-8">
                <PremiumButton variant="cta" icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
                  {centro.ctaText}
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
                  src={centro.mapUrl}
                  className="absolute inset-0 w-full h-full"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Focus Club Vallecas - Mapa"
                />
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
