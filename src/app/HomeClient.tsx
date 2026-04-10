'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Star, Clock, Activity, Apple, Trophy, Dumbbell, Heart, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import type { CMSContent, Service, Testimonial, HeroStat } from '@/types';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

const ICON_MAP: Record<string, LucideIcon> = { Dumbbell, Trophy, Apple, Activity, Users, Heart };

const DEFAULT_HERO_STATS: HeroStat[] = [
  { icon: 'Award', value: '15+', label: 'Años de Experiencia' },
  { icon: 'Users', value: '500+', label: 'Clientes Satisfechos' },
  { icon: 'Dumbbell', value: '4', label: 'Servicios Premium' },
  { icon: 'Heart', value: '100%', label: 'Compromiso' },
];

// ─── Skeleton placeholders ────────────────────────────────────────────────────

function ServiceSkeleton() {
  return (
    <div className="h-48 rounded-[var(--radius-card)] card-glass animate-pulse">
      <div className="p-6 space-y-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--color-accent-dim)]" />
        <div className="h-4 w-2/3 rounded bg-white/5" />
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-4/5 rounded bg-white/5" />
      </div>
    </div>
  );
}

function TestimonialSkeleton() {
  return (
    <div className="h-44 rounded-[var(--radius-card)] card-glass animate-pulse">
      <div className="p-6 space-y-3">
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-4 h-4 rounded bg-white/5" />
          ))}
        </div>
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-4/5 rounded bg-white/5" />
        <div className="h-3 w-3/5 rounded bg-white/5" />
        <div className="flex items-center gap-3 pt-2">
          <div className="w-10 h-10 rounded-full bg-white/5" />
          <div className="space-y-1">
            <div className="h-3 w-24 rounded bg-white/5" />
            <div className="h-2 w-16 rounded bg-white/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface HomeClientProps {
  initialCMS: CMSContent;
  initialServices: Service[];
  initialTestimonials: Testimonial[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeClient({ initialCMS: cmsContent, initialServices: services, initialTestimonials: testimonials }: HomeClientProps) {
  const heroBackgroundType = cmsContent.heroBackgroundType === 'image' ? 'image' : 'video';
  const heroBackgroundUrl = cmsContent.heroBackgroundUrl ?? '/imagenes/hero.mp4';
  const aboutEyebrow = cmsContent.aboutEyebrow ?? 'Conoce a tu entrenadora';
  const aboutButtonText = cmsContent.aboutButtonText ?? 'Leer mas';
  const aboutButtonLink = cmsContent.aboutButtonLink ?? '/sandra';
  const aboutBadgeOneIcon = cmsContent.aboutBadgeOneIcon ?? 'Award';
  const aboutBadgeOneText = cmsContent.aboutBadgeOneText ?? 'Certificacion Internacional';
  const aboutBadgeTwoIcon = cmsContent.aboutBadgeTwoIcon ?? 'Heart';
  const aboutBadgeTwoText = cmsContent.aboutBadgeTwoText ?? 'Atencion Personalizada';
  const aboutCardName = cmsContent.aboutCardName ?? 'Sandra Andujar';
  const aboutCardRole = cmsContent.aboutCardRole ?? 'Fundadora & Coach Principal';

  return (
    <div className="min-h-screen">

      {/* ═══════════════════════════════════════════════════════════════════
          HERO SECTION
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden -mt-20">
        {/* Hero Background */}
        <div className="absolute inset-0">
          {heroBackgroundType === 'video' ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              className="object-cover w-full h-full opacity-40"
            >
              <source src={heroBackgroundUrl} type="video/mp4" />
            </video>
          ) : (
            <Image
              src={heroBackgroundUrl}
              alt="Fondo hero Focus Club Vallecas"
              fill
              priority
              className="object-cover w-full h-full opacity-40"
            />
          )}
          <div className="absolute inset-0 bg-[var(--color-bg-base)]/85" />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-base)] via-transparent to-[var(--color-bg-base)]/50" />
        </div>

        <div className="container mx-auto px-4 py-20 relative z-10">
          <motion.div
            className="max-w-5xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Eyebrow Badge */}
            <motion.span
              className="eyebrow mb-8 justify-center"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {cmsContent.heroEyebrow ?? 'Bienvenido a Focus Club Vallecas'}
            </motion.span>

            {/* Hero Title */}
            <motion.h1
              className="font-extrabold mb-6 leading-[1.1]"
              style={{ fontSize: 'clamp(32px, 4.5vw, 58px)', letterSpacing: '-2px' }}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {cmsContent.heroTitleStart && cmsContent.heroTitleHighlight ? (
                <>
                  <span className="glow-text">{cmsContent.heroTitleStart} </span>
                  <span className="text-[var(--color-accent-val)]">{cmsContent.heroTitleHighlight}</span>
                </>
              ) : (
                <span className="glow-text">{cmsContent.heroTitle}</span>
              )}
            </motion.h1>

            {/* Hero Subtitle */}
            <motion.p
              className="text-lg md:text-xl text-[var(--color-text-secondary)] mb-10 max-w-2xl mx-auto leading-relaxed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              {cmsContent.heroSubtitle}
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              <Link href={cmsContent.heroCtaPrimaryLink ?? '/portal'}>
                <PremiumButton variant="cta" size="lg" icon={<ArrowRight className="w-5 h-5" />} iconPosition="right">
                  {cmsContent.heroCTA}
                </PremiumButton>
              </Link>
              <Link href={cmsContent.heroCtaSecondaryLink ?? '/servicios'}>
                <PremiumButton variant="outline" size="lg">
                  {cmsContent.heroCtaSecondaryText ?? 'Ver Servicios'}
                </PremiumButton>
              </Link>
            </motion.div>

            {/* Stats Row */}
            <motion.div
              className="flex flex-wrap justify-center items-center gap-8 md:gap-12 mt-16"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {(cmsContent.heroStats ?? DEFAULT_HERO_STATS).map((stat, i) => (
                <motion.div
                  key={i}
                  className="flex items-center gap-4"
                  variants={itemVariants}
                >
                  {i > 0 && (
                    <div className="hidden md:block w-px h-10 bg-[rgba(255,255,255,0.08)] -ml-6 mr-2" />
                  )}
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0">
                    <DynamicIcon name={stat.icon} className="w-5 h-5 text-[var(--color-accent-val)]" />
                  </div>
                  <div className="text-left">
                    <div className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)]">{stat.value}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">{stat.label}</div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <div className="w-6 h-10 rounded-full border-2 border-[var(--color-text-muted)] flex items-start justify-center p-2">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-val)]"
              animate={{ y: [0, 12, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            />
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          ABOUT SECTION
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-14 relative">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-10 items-center max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="eyebrow">
                {aboutEyebrow}
              </span>
              <h2 className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] mt-3 mb-4">
                {cmsContent.aboutTitle}
              </h2>
              <div className="line-accent mb-6" />
              <p className="text-[var(--color-text-secondary)] leading-relaxed mb-5">
                {cmsContent.aboutText}
              </p>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-accent-dim)] flex items-center justify-center">
                    <DynamicIcon name={aboutBadgeOneIcon} className="w-4 h-4 text-[var(--color-accent-val)]" />
                  </div>
                  <span className="text-sm text-[var(--color-text-secondary)]">{aboutBadgeOneText}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-accent-dim)] flex items-center justify-center">
                    <DynamicIcon name={aboutBadgeTwoIcon} className="w-4 h-4 text-[var(--color-accent-val)]" />
                  </div>
                  <span className="text-sm text-[var(--color-text-secondary)]">{aboutBadgeTwoText}</span>
                </div>
              </div>
              <Link href={aboutButtonLink} className="inline-block mt-6">
                <PremiumButton variant="outline" icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
                  {aboutButtonText}
                </PremiumButton>
              </Link>
            </motion.div>

            <motion.div
              className="relative max-w-xs mx-auto lg:max-w-none"
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="rounded-3xl overflow-hidden card-glass p-2">
                <div className="relative rounded-2xl overflow-hidden">
                  <Image
                    src={cmsContent.aboutImage}
                    alt={`${aboutCardName} - ${aboutCardRole}`}
                    width={600}
                    height={800}
                    className="w-full h-auto object-cover object-top"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-base)]/80 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4 text-center">
                    <p className="text-[var(--color-text-primary)] font-semibold">{aboutCardName}</p>
                    <p className="text-[var(--color-accent-val)] text-sm">{aboutCardRole}</p>
                  </div>
                </div>
              </div>
              <div className="absolute -top-4 -right-4 w-20 h-20 bg-[var(--color-accent-val)]/15 rounded-full blur-2xl" />
              <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-[var(--color-accent-val)]/10 rounded-full blur-2xl" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SERVICES SECTION
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-[var(--color-bg-surface)]" />
        <div className="container mx-auto px-4 relative">
          <motion.div
            className="text-center max-w-2xl mx-auto mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="eyebrow justify-center">
              Nuestros Servicios
            </span>
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3 mb-4">
              {cmsContent.servicesTitle}
            </h2>
            <p className="text-[var(--color-text-secondary)]">
              {cmsContent.servicesSubtitle}
            </p>
            <div className="line-accent mx-auto mt-4" />
          </motion.div>

          <motion.div
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {services.length > 0
              ? services.slice(0, 4).map((service) => {
                  const Icon = (service.icon && ICON_MAP[service.icon]) || Dumbbell;
                  return (
                    <motion.div key={service.id} variants={itemVariants}>
                      <Link href={`/servicios#${service.id}`}>
                        <GlassCard className="h-full group cursor-pointer relative overflow-hidden">
                          {/* Top accent bar on hover */}
                          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-accent-val)] scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left" />
                          <div className="w-10 h-10 rounded-lg bg-[var(--color-accent-dim)] group-hover:bg-[var(--color-accent-val)]/15 transition-colors duration-300 flex items-center justify-center mb-4">
                            <Icon className="w-5 h-5 text-[var(--color-accent-val)] transition-colors" />
                          </div>
                          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2 group-hover:text-[var(--color-accent-val)] transition-colors duration-300">
                            {service.title}
                          </h3>
                          <p className="text-[var(--color-text-secondary)] text-sm mb-4 line-clamp-2">
                            {service.description}
                          </p>
                          <div className="flex items-center">
                            <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {service.duration}
                            </span>
                          </div>
                        </GlassCard>
                      </Link>
                    </motion.div>
                  );
                })
              : Array.from({ length: 4 }).map((_, i) => (
                  <motion.div key={i} variants={itemVariants}>
                    <ServiceSkeleton />
                  </motion.div>
                ))}
          </motion.div>

          <div className="text-center mt-12">
            <Link href="/servicios">
              <PremiumButton variant="outline" icon={<ArrowRight className="w-4 h-4" />} iconPosition="right">
                Ver todos los servicios
              </PremiumButton>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          TESTIMONIALS SECTION
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center max-w-2xl mx-auto mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="eyebrow justify-center">
              {cmsContent.testimonialsEyebrow ?? 'TESTIMONIOS'}
            </span>
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mt-3 mb-4">
              {cmsContent.testimonialsTitle}
            </h2>
            <div className="line-accent mx-auto mt-4" />
          </motion.div>

          <motion.div
            className="grid md:grid-cols-3 gap-6"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {testimonials.length > 0
              ? testimonials.map((testimonial) => (
                  <motion.div key={testimonial.id} variants={itemVariants}>
                    <GlassCard className="h-full">
                      <div className="flex items-center gap-1 mb-4">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-4 h-4 ${i < testimonial.rating ? 'text-[var(--color-accent-val)] fill-[var(--color-accent-val)]' : 'text-[var(--color-text-muted)]'}`}
                          />
                        ))}
                      </div>
                      <p className="text-[var(--color-text-secondary)] text-sm mb-6 italic leading-relaxed">
                        &ldquo;{testimonial.content}&rdquo;
                      </p>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[var(--color-accent-dim)] flex items-center justify-center text-[var(--color-accent-val)] font-semibold text-sm">
                          {testimonial.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-[var(--color-text-primary)] font-medium text-sm">{testimonial.name}</p>
                          <p className="text-[var(--color-text-muted)] text-xs">{testimonial.role}</p>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                ))
              : Array.from({ length: 3 }).map((_, i) => (
                  <motion.div key={i} variants={itemVariants}>
                    <TestimonialSkeleton />
                  </motion.div>
                ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CTA SECTION
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-[var(--color-accent-dim)]" />
        {/* Glow effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[var(--color-accent-val)]/5 blur-3xl pointer-events-none" />
        <div className="container mx-auto px-4 relative">
          <motion.div
            className="max-w-3xl mx-auto text-center card-glass rounded-3xl p-6 md:p-12"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-[var(--font-size-section)] font-bold text-[var(--color-text-primary)] mb-4">
              {cmsContent.ctaTitle}
            </h2>
            <p className="text-[var(--color-text-secondary)] text-lg mb-8">
              {cmsContent.ctaSubtitle}
            </p>
            <Link href={cmsContent.ctaButtonLink ?? '/portal'}>
              <PremiumButton variant="cta" size="lg" icon={<ArrowRight className="w-5 h-5" />} iconPosition="right">
                {cmsContent.ctaButtonText ?? 'Solicitar Cita'}
              </PremiumButton>
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
