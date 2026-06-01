'use client';

import Link from 'next/link';
import { ArrowLeft, UserX } from 'lucide-react';
import { PremiumButton } from '@/components/ui/premium-button';
import { GlassCard } from '@/components/ui/glass-card';

export default function EliminarCuentaPage() {
    return (
        <div className="min-h-screen py-16">
            <div className="container mx-auto px-4 max-w-3xl">
                <div className="mb-12">
                    <Link href="/">
                        <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                            Volver al inicio
                        </PremiumButton>
                    </Link>
                </div>

                <GlassCard className="p-8 md:p-12">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center">
                            <UserX className="w-6 h-6 text-[var(--color-accent-val)]" />
                        </div>
                        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Eliminación de cuenta</h1>
                    </div>

                    <div className="prose prose-invert prose-sm max-w-none space-y-6 text-[var(--color-text-secondary)]">
                        <p>
                            Los usuarios de la app Focus Club pueden solicitar la eliminación de su cuenta y de los datos
                            personales asociados.
                        </p>

                        <p>Para solicitarlo, deben enviar un email a:</p>

                        <p>
                            <a href="mailto:infofocusclub2026@gmail.com" className="text-[var(--color-accent-val)] hover:underline">
                                infofocusclub2026@gmail.com
                            </a>
                        </p>

                        <p>Indicando:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>el correo electrónico asociado a la cuenta;</li>
                            <li>que desean eliminar su cuenta de Focus Club.</li>
                        </ul>

                        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mt-8">Plazo</h2>
                        <p>La solicitud será revisada y procesada en un plazo máximo de 30 días.</p>

                        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mt-8">Datos que pueden eliminarse</h2>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>nombre;</li>
                            <li>correo electrónico;</li>
                            <li>teléfono;</li>
                            <li>foto de perfil;</li>
                            <li>datos de perfil;</li>
                            <li>solicitudes de cita y reservas asociadas a la cuenta;</li>
                            <li>tokens de notificaciones push.</li>
                        </ul>

                        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mt-8">Datos que podrían conservarse</h2>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>
                                información estrictamente necesaria para cumplir obligaciones legales, administrativas o de
                                seguridad;
                            </li>
                            <li>
                                registros mínimos necesarios para resolver incidencias o prevenir abusos, durante el plazo legal
                                o técnico necesario.
                            </li>
                        </ul>

                        <p>
                            Si tienes dudas sobre el tratamiento de tus datos, puedes consultar nuestra{' '}
                            <Link href="/politica-de-privacidad" className="text-[var(--color-accent-val)] hover:underline">
                                Política de Privacidad
                            </Link>.
                        </p>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
}
