'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useInView, animate } from 'framer-motion';
import Image from 'next/image';
import { Play, X, ChevronLeft, ChevronRight, Quote } from 'lucide-react';
import type { GaleriaContent } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CloudinaryResource {
  public_id: string;
  url: string;
  resource_type: 'image' | 'video';
  format: string;
  width: number;
  height: number;
  folder: string;
}

interface LightboxItem {
  src: string;
  type: 'image' | 'video';
  title?: string;
}

interface TrainingItem {
  src: string;
  title: string;
  type: 'image' | 'video';
}

// ─── Static fallback data ─────────────────────────────────────────────────────

const STATS_FALLBACK = [
  { value: 200, suffix: '+', label: 'Clientes transformados' },
  { value: 20, suffix: ' años', label: 'De experiencia' },
  { value: 100, suffix: '%', label: 'Compromiso' },
];

const TRANSFORMACIONES_FALLBACK = [
  {
    name: 'María García',
    periodo: '16 semanas',
    resultado: '-18 kg',
    antes: '/imagenes/inventadas/antes-1.svg',
    despues: '/imagenes/inventadas/despues-1.svg',
  },
  {
    name: 'Carlos Martínez',
    periodo: '20 semanas',
    resultado: '+12 kg músculo',
    antes: '/imagenes/inventadas/antes-2.svg',
    despues: '/imagenes/inventadas/despues-2.svg',
  },
  {
    name: 'Laura Pérez',
    periodo: '12 semanas',
    resultado: '1er puesto',
    antes: '/imagenes/inventadas/antes-3.svg',
    despues: '/imagenes/inventadas/despues-3.svg',
  },
];

const TRAINING_FALLBACK: TrainingItem[] = [
  { src: '/imagenes/inventadas/entrenamiento-1.svg', title: 'Entrenamiento de Fuerza', type: 'image' },
  { src: '/imagenes/inventadas/entrenamiento-2.svg', title: 'Hipertrofia Muscular', type: 'image' },
  { src: '/imagenes/inventadas/entrenamiento-3.svg', title: 'Cardio HIIT', type: 'image' },
  { src: '/imagenes/inventadas/entrenamiento-4.svg', title: 'Nutrición Deportiva', type: 'image' },
  { src: '/imagenes/inventadas/entrenamiento-5.svg', title: 'Prep. Competición', type: 'image' },
  { src: '/imagenes/inventadas/entrenamiento-6.svg', title: 'Seguimiento Progreso', type: 'image' },
];

const RESULTADOS_FALLBACK = [
  {
    name: 'María García',
    stat: '-18 kg',
    statLabel: 'en 4 meses',
    tag: 'Pérdida de peso',
    image: '/imagenes/inventadas/resultado-1.svg',
    story: '"Nunca pensé que podría estar así de bien. Sandra me cambió la vida, no solo el cuerpo. El método es brutal."',
    detail: 'De 78 kg a 60 kg. Cambio total de composición corporal con plan de nutrición incluido.',
  },
  {
    name: 'Carlos Martínez',
    stat: '+12 kg',
    statLabel: 'masa muscular',
    tag: 'Hipertrofia',
    image: '/imagenes/inventadas/resultado-2.svg',
    story: '"Llevaba años en el gimnasio sin avanzar. En 6 meses con Sandra conseguí más que en 4 años solo."',
    detail: 'Programa de hipertrofia progresivo con periodización avanzada y seguimiento semanal.',
  },
  {
    name: 'Laura Pérez',
    stat: '1er',
    statLabel: 'puesto competición',
    tag: 'Competición',
    image: '/imagenes/inventadas/resultado-3.svg',
    story: '"Preparar mi primera competición con Sandra fue la mejor decisión. Técnica, nutrición y mentalidad: 10/10."',
    detail: 'Preparación completa para competición de fitness en 5 meses. Primera vez en escenario.',
  },
  {
    name: 'Ana Rodríguez',
    stat: '100%',
    statLabel: 'objetivo cumplido',
    tag: 'Definición',
    image: '/imagenes/inventadas/resultado-4.svg',
    story: '"Entré buscando definición y salí con un estilo de vida completamente nuevo. Increíble equipo."',
    detail: 'Programa de definición y tonificación de 3 meses con resultados visibles desde la semana 4.',
  },
];

// ─── Animated Counter ─────────────────────────────────────────────────────────

function AnimatedCounter({ value, suffix }: { value: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });

  useEffect(() => {
    if (!inView || !ref.current) return;
    const controls = animate(0, value, {
      duration: 2,
      ease: 'easeOut',
      onUpdate(v: number) {
        if (ref.current) ref.current.textContent = Math.round(v) + suffix;
      },
    });
    return () => controls.stop();
  }, [inView, value, suffix]);

  return <span ref={ref}>0{suffix}</span>;
}

// ─── Before/After Card ────────────────────────────────────────────────────────

function BeforeAfterCard({ item }: { item: (typeof TRANSFORMACIONES_FALLBACK)[0] }) {
  const [sliderPos, setSliderPos] = useState(50);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateSlider = useCallback((clientX: number) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  return (
    <div
      ref={cardRef}
      className="relative rounded-3xl overflow-hidden select-none before-after-slider w-full"
      style={{ aspectRatio: '5/7' }}
      onMouseDown={(e) => { dragging.current = true; updateSlider(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updateSlider(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => { dragging.current = true; updateSlider(e.touches[0].clientX); }}
      onTouchMove={(e) => { if (dragging.current) updateSlider(e.touches[0].clientX); }}
      onTouchEnd={() => { dragging.current = false; }}
    >
      <Image src={item.despues} alt={`Después ${item.name}`} fill unoptimized className="object-cover" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
        <Image src={item.antes} alt={`Antes ${item.name}`} fill unoptimized className="object-cover" />
        <div className="absolute top-4 left-4 bg-black/60 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-sm border border-white/20">
          ANTES
        </div>
      </div>
      <div className="absolute top-4 right-4 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-sm border border-[var(--color-accent-border)]"
        style={{ background: 'rgba(45,106,79,0.75)' }}>
        DESPUÉS
      </div>
      <div className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.8)]"
        style={{ left: `${sliderPos}%` }} />
      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center z-10"
        style={{ left: `${sliderPos}%` }}>
        <ChevronLeft className="w-3 h-3 text-gray-800 -mr-0.5" />
        <ChevronRight className="w-3 h-3 text-gray-800 -ml-0.5" />
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none">
        <p className="text-white font-bold text-sm">{item.name}</p>
        <p className="text-[var(--color-accent-val)] text-xs">{item.resultado} · {item.periodo}</p>
      </div>
    </div>
  );
}

// ─── Image Carousel ───────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};

function ImageCarousel({
  items,
  onOpen,
}: {
  items: TrainingItem[];
  onOpen: (item: LightboxItem) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [dir, setDir] = useState(1);
  const touchStartX = useRef(0);
  const total = items.length;

  const go = useCallback((next: number) => {
    setDir(next > current || (current === total - 1 && next === 0) ? 1 : -1);
    setCurrent(next);
  }, [current, total]);

  const prev = () => {
    const next = (current - 1 + total) % total;
    setDir(-1);
    setCurrent(next);
  };

  const next = useCallback(() => {
    const n = (current + 1) % total;
    setDir(1);
    setCurrent(n);
  }, [current, total]);

  // Auto-advance
  useEffect(() => {
    const t = setInterval(next, 4000);
    return () => clearInterval(t);
  }, [next]);

  const item = items[current];

  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={current}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            className="absolute inset-0"
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - touchStartX.current;
              if (Math.abs(dx) > 40) dx < 0 ? next() : prev();
            }}
          >
            <Image
              src={item.src}
              alt={item.title}
              fill
              unoptimized
              className="object-cover"
            />
            {item.type === 'video' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center border border-white/20">
                  <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
                </div>
              </div>
            )}
            {/* Overlay on hover / title */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-4 pointer-events-none">
              <p className="text-white font-semibold text-sm">{item.title}</p>
            </div>
            {/* Click to open lightbox */}
            <button
              className="absolute inset-0 w-full h-full"
              onClick={() => onOpen({ src: item.src, type: item.type, title: item.title })}
              aria-label={`Ver ${item.title}`}
            />
          </motion.div>
        </AnimatePresence>

        {/* Prev / Next arrows */}
        <button
          onClick={prev}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-[var(--color-accent-val)]/70 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={next}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:bg-[var(--color-accent-val)]/70 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 pt-1">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'w-6 bg-[var(--color-accent-val)]' : 'w-1.5 bg-white/20 hover:bg-white/40'}`}
            aria-label={`Ir a imagen ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GaleriaClient({ initialResources, galeriaContent }: { initialResources: CloudinaryResource[]; galeriaContent?: GaleriaContent }) {
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  const STATS = galeriaContent?.stats ?? STATS_FALLBACK;
  const TRANSFORMACIONES = (galeriaContent?.transformaciones ?? TRANSFORMACIONES_FALLBACK).map((t, i) => ({
    ...t,
    antes: `/imagenes/inventadas/antes-${i + 1}.svg`,
    despues: `/imagenes/inventadas/despues-${i + 1}.svg`,
  }));
  const RESULTADOS = (galeriaContent?.resultados ?? RESULTADOS_FALLBACK).map((r, i) => ({
    ...r,
    image: `/imagenes/inventadas/resultado-${i + 1}.svg`,
  }));

  const trainingItems: TrainingItem[] = initialResources.length > 0
    ? initialResources.map((r) => ({
        src: r.resource_type === 'video' ? r.url.replace(/\.(mp4|mov|avi|webm)$/i, '.jpg') : r.url,
        title: `Focus Club · ${r.format.toUpperCase()}`,
        type: r.resource_type,
      }))
    : TRAINING_FALLBACK;

  // Split items into 2 groups for the two carousels
  const mid = Math.ceil(trainingItems.length / 2);
  const carousel1 = trainingItems.slice(0, mid);
  const carousel2 = trainingItems.slice(mid);

  return (
    <div className="space-y-0">

      {/* ═══ SECCIÓN 1 · HERO ═══════════════════════════════════════════ */}
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
              Nuestra Galería
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mt-3 mb-6">
              {galeriaContent?.heroTitle ?? 'Resultados Reales'}
            </h1>
            <div className="line-accent mx-auto mb-6" />
            <p className="text-[var(--color-text-secondary)] text-lg">
              {galeriaContent?.heroSubtitle ?? 'Cada imagen cuenta una historia de esfuerzo, constancia y transformación.'}
            </p>
          </motion.div>

          <div className="grid grid-cols-3 gap-4 md:gap-8 max-w-2xl mx-auto mt-12">
            {STATS.map((stat, i) => (
              <motion.div
                key={stat.label}
                className="glass-card rounded-2xl p-4 md:p-6 text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
              >
                <div className="text-3xl md:text-4xl font-black text-[var(--color-accent-val)] tabular-nums">
                  <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                </div>
                <div className="text-[var(--color-text-secondary)] text-xs md:text-sm mt-1">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>


      {/* ═══ SECCIÓN 2 · TRANSFORMACIONES ══════════════════════════════ */}
      <section className="py-24 relative overflow-hidden">

        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="eyebrow">
              Antes &amp; Después
            </span>
            <h2 className="text-4xl md:text-5xl font-black text-[var(--color-text-primary)] mb-4">Transformaciones</h2>
            <div className="line-accent mx-auto mb-4" />
            <p className="text-[var(--color-text-secondary)] max-w-xl mx-auto">
              Arrastra el slider sobre cada imagen para ver el cambio.
            </p>
          </motion.div>

          {/* Centered cards — flex wrap on mobile, single row centered on desktop */}
          <div className="flex flex-wrap justify-center gap-6">
            {TRANSFORMACIONES.map((item, i) => (
              <motion.div
                key={item.name}
                className="w-full max-w-[300px]"
                initial={{ opacity: 0, x: i % 2 === 0 ? -60 : 60 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.7, delay: i * 0.15 }}
              >
                <BeforeAfterCard item={item} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>


      {/* ═══ SECCIÓN 3 · ENTRENAMIENTOS (2 Carruseles) ══════════════════ */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-[var(--color-bg-surface)]/40" />
        <div className="container mx-auto px-4 relative">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="eyebrow">
              En Acción
            </span>
            <h2 className="text-4xl md:text-5xl font-black text-[var(--color-text-primary)] mb-4">Entrenamientos</h2>
            <div className="line-accent mx-auto mb-4" />
            <p className="text-[var(--color-text-secondary)] max-w-xl mx-auto">
              Imágenes de las sesiones. Pasan automáticamente o navega con las flechas. Haz click para ampliar.
            </p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            {carousel1.length > 0 && (
              <ImageCarousel items={carousel1} onOpen={setLightbox} />
            )}
            {carousel2.length > 0 && (
              <ImageCarousel items={carousel2} onOpen={setLightbox} />
            )}
          </motion.div>
        </div>
      </section>


      {/* ═══ SECCIÓN 4 · RESULTADOS (Flip Cards) ═══════════════════════ */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="eyebrow">
              Historias Reales
            </span>
            <h2 className="text-4xl md:text-5xl font-black text-[var(--color-text-primary)] mb-4">Resultados</h2>
            <div className="line-accent mx-auto mb-4" />
            <p className="text-[var(--color-text-secondary)] max-w-xl mx-auto">
              Pasa el cursor sobre cada tarjeta para descubrir la historia detrás del resultado.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {RESULTADOS.map((r, i) => (
              <motion.div
                key={r.name}
                className="flip-card h-80"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.6, delay: i * 0.12 }}
              >
                <div className="flip-card-inner w-full h-full">
                  {/* FRONT */}
                  <div className="flip-card-front glass-card flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden mb-4 border border-[var(--color-accent-border)]">
                      <Image src={r.image} alt={r.name} width={64} height={64} unoptimized className="w-full h-full object-cover" />
                    </div>
                    <div className="text-4xl font-black text-[var(--color-accent-val)] mb-1">{r.stat}</div>
                    <div className="text-[var(--color-text-secondary)] text-sm mb-3">{r.statLabel}</div>
                    <div className="text-[var(--color-text-primary)] font-bold text-base mb-1">{r.name}</div>
                    <span className="inline-block px-3 py-1 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-xs font-medium border border-[var(--color-accent-border)]">
                      {r.tag}
                    </span>
                    <p className="text-white/30 text-xs mt-4">Pasa el cursor →</p>
                  </div>

                  {/* BACK */}
                  <div className="flip-card-back flex flex-col justify-between p-6"
                    style={{ background: 'linear-gradient(135deg, rgba(13,13,13,0.95) 0%, rgba(8,8,8,0.98) 100%)', border: '1px solid var(--color-accent-border)' }}>
                    <Quote className="w-8 h-8 text-[var(--color-accent-val)]/60 mb-3" />
                    <p className="text-white/85 text-sm leading-relaxed italic flex-1">{r.story}</p>
                    <div className="mt-4 pt-4 border-t border-[var(--color-accent-border)]">
                      <p className="text-[var(--color-text-primary)] font-bold text-sm">{r.name}</p>
                      <p className="text-white/40 text-xs mt-1">{r.detail}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>


      {/* ═══ LIGHTBOX ═══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              className="relative max-w-4xl w-full max-h-[90vh]"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              {lightbox.title && (
                <p className="text-white/60 text-sm mb-3 text-center">{lightbox.title}</p>
              )}
              {lightbox.type === 'video' ? (
                <video src={lightbox.src} controls autoPlay className="w-full rounded-2xl shadow-2xl max-h-[80vh]" />
              ) : (
                <div className="relative w-full rounded-2xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <Image src={lightbox.src} alt={lightbox.title || 'Galería'} fill unoptimized className="object-contain" />
                </div>
              )}
              <button
                onClick={() => setLightbox(null)}
                className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-black border border-white/20 text-white flex items-center justify-center hover:bg-red-600/80 hover:border-red-500 transition-colors shadow-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
