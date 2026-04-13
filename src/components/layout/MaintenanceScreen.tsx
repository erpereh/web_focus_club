'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock3, Mail, MessageCircle, Wrench } from 'lucide-react';
import { PremiumButton } from '@/components/ui/premium-button';
import { useBrandingConfig } from '@/hooks/useBrandingConfig';
import { useCMS } from '@/hooks/useFirestore';

export function MaintenanceScreen() {
  const { logoUrl } = useBrandingConfig();
  const { cmsContent } = useCMS();

  const whatsappNumber = cmsContent.whatsapp.replace(/\D/g, '');
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}` : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,136,0.14),transparent_48%),radial-gradient(circle_at_bottom,rgba(0,255,136,0.08),transparent_42%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.12),rgba(5,5,5,0.84))]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-4xl rounded-[32px] border border-white/10 bg-[rgba(12,12,12,0.84)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-10"
        >
          <div className="mb-10 flex items-center gap-4">
            <div className="relative h-14 w-14 overflow-hidden rounded-full border border-[var(--color-accent-border)] bg-black/30">
              <Image
                src={logoUrl ?? '/imagenes/logo.jpeg'}
                alt="Focus Club Vallecas"
                fill
                sizes="56px"
                className="object-cover"
                unoptimized={!!logoUrl}
                priority
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--color-accent-val)]">Focus Club Vallecas</p>
              <p className="text-sm text-[var(--color-text-secondary)]">Aviso temporal del sistema</p>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] px-4 py-2 text-sm text-[var(--color-accent-val)]">
                <Wrench className="h-4 w-4" />
                Modo mantenimiento activado
              </div>

              <h1 className="max-w-2xl text-4xl font-black leading-tight text-[var(--color-text-primary)] md:text-5xl">
                Estamos realizando tareas de mantenimiento para volver cuanto antes.
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-text-secondary)]">
                Hemos pausado temporalmente el acceso a la web y al portal de clientes para revisar el sistema con seguridad.
                Volveremos en breve con todo funcionando correctamente.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {whatsappUrl && (
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <PremiumButton
                      size="lg"
                      icon={<MessageCircle className="h-4 w-4" />}
                    >
                      Contactar por WhatsApp
                    </PremiumButton>
                  </a>
                )}
                <a href={`mailto:${cmsContent.email}`}>
                  <PremiumButton
                    variant="outline"
                    size="lg"
                    icon={<Mail className="h-4 w-4" />}
                  >
                    Escribir por Email
                  </PremiumButton>
                </a>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/25 p-6">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]">
                <AlertTriangle className="h-7 w-7" />
              </div>

              <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Qué está pasando</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                Hemos activado el modo mantenimiento para evitar reservas o cambios mientras revisamos una incidencia.
              </p>

              <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 text-[var(--color-accent-val)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">Reanudación</p>
                    <p className="text-sm text-[var(--color-text-secondary)]">Intentaremos restablecer el servicio lo antes posible.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 text-[var(--color-accent-val)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">Contacto directo</p>
                    <p className="text-sm text-[var(--color-text-secondary)] break-all">{cmsContent.email}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 text-[var(--color-accent-val)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">WhatsApp</p>
                    <p className="text-sm text-[var(--color-text-secondary)]">{cmsContent.whatsapp}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
