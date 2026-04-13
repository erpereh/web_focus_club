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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,136,0.16),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(0,255,136,0.08),transparent_36%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.18),rgba(5,5,5,0.9))]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="relative w-full max-w-[980px] overflow-hidden rounded-[32px] border border-white/10 bg-[rgba(10,12,11,0.88)] shadow-[0_30px_120px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent-val)]/60 to-transparent" />

          <div className="p-5 sm:p-8 lg:p-10">
            <div className="mb-9 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-[var(--color-accent-border)] bg-black/30 shadow-[0_0_35px_rgba(0,255,136,0.12)]">
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
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.35em] text-[var(--color-accent-val)]">Focus Club Vallecas</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">Aviso temporal del sistema</p>
                </div>
              </div>

            </div>

            <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-stretch">
              <div className="flex min-w-0 flex-col justify-center">
                <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] px-4 py-2 text-sm text-[var(--color-accent-val)]">
                  <Wrench className="h-4 w-4" />
                  Modo mantenimiento activado
                </div>

                <h1 className="max-w-2xl text-3xl font-black leading-[1.08] tracking-[-0.03em] text-[var(--color-text-primary)] sm:text-4xl lg:text-[46px]">
                  Estamos ajustando la plataforma para volver cuanto antes.
                </h1>

                <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--color-text-secondary)] sm:text-lg">
                  Hemos pausado temporalmente el acceso a la web y al portal de clientes para revisar el sistema.
                  Volveremos en breve con todo funcionando correctamente.
                </p>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  {whatsappUrl && (
                    <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                      <PremiumButton
                        size="lg"
                        icon={<MessageCircle className="h-4 w-4" />}
                        className="w-full sm:w-auto"
                      >
                        Contactar por WhatsApp
                      </PremiumButton>
                    </a>
                  )}
                  <a href={`mailto:${cmsContent.email}`} className="w-full sm:w-auto">
                    <PremiumButton
                      variant="outline"
                      size="lg"
                      icon={<Mail className="h-4 w-4" />}
                      className="w-full sm:w-auto"
                    >
                      Escribir por Email
                    </PremiumButton>
                  </a>
                </div>
              </div>

              <aside className="min-w-0 rounded-[28px] border border-white/10 bg-black/30 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
                <div className="mb-6 flex items-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                </div>

                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Qu&eacute; est&aacute; pasando</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                  El acceso p&uacute;blico est&aacute; en pausa para evitar reservas o cambios mientras revisamos una incidencia.
                </p>

                <div className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-val)]" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">Reanudaci&oacute;n</p>
                      <p className="text-sm leading-6 text-[var(--color-text-secondary)]">Intentaremos restablecer el servicio lo antes posible.</p>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-start gap-3">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-val)]" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">Contacto directo</p>
                      <a
                        href={`mailto:${cmsContent.email}`}
                        title={cmsContent.email}
                        className="block max-w-full truncate text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-val)]"
                      >
                        {cmsContent.email}
                      </a>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-start gap-3">
                    <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-val)]" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">WhatsApp</p>
                      {whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-full truncate text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-val)]"
                        >
                          {cmsContent.whatsapp}
                        </a>
                      ) : (
                        <p className="text-sm text-[var(--color-text-secondary)]">{cmsContent.whatsapp}</p>
                      )}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
