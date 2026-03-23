'use client';

import Link from 'next/link';
import { Cookie, ArrowLeft } from 'lucide-react';
import { PremiumButton } from '@/components/ui/premium-button';
import { GlassCard } from '@/components/ui/glass-card';

export default function CookiesPage() {
    return (
        <div className="min-h-screen py-16">
            <div className="container mx-auto px-4 max-w-3xl">
                {/* Header */}
                <div className="mb-12">
                    <Link href="/">
                        <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                            Volver al inicio
                        </PremiumButton>
                    </Link>
                </div>

                <GlassCard className="p-8 md:p-12">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                            <Cookie className="w-6 h-6 text-primary" />
                        </div>
                        <h1 className="text-3xl font-bold text-ivory">Política de Cookies</h1>
                    </div>

                    <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">
                        <p className="text-ivory/80">
                            <strong>Última actualización:</strong> Febrero 2026
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">1. ¿Qué son las cookies?</h2>
                        <p>
                            Las cookies son pequeños archivos de texto que se almacenan en tu dispositivo cuando visitas
                            nuestro sitio web. Se utilizan para recordar tus preferencias, mejorar tu experiencia de
                            navegación y analizar el uso del sitio.
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">2. Tipos de Cookies que Utilizamos</h2>

                        <h3 className="text-lg font-medium text-ivory mt-4">Cookies Técnicas (Necesarias)</h3>
                        <p>
                            Son esenciales para el funcionamiento del sitio web. Incluyen cookies de sesión de
                            autenticación proporcionadas por Firebase Authentication.
                        </p>

                        <h3 className="text-lg font-medium text-ivory mt-4">Cookies de Preferencias</h3>
                        <p>
                            Almacenan tus preferencias de navegación, como la aceptación de esta política de cookies
                            y ajustes de visualización.
                        </p>

                        <h3 className="text-lg font-medium text-ivory mt-4">Cookies Analíticas</h3>
                        <p>
                            Nos ayudan a entender cómo los visitantes interactúan con el sitio web, recopilando
                            información de forma anónima. Pueden incluir servicios de terceros como Google Analytics.
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">3. Gestión de Cookies</h2>
                        <p>
                            Puedes configurar tu navegador para rechazar cookies o para que te avise cuando se envíen.
                            Ten en cuenta que si desactivas las cookies, algunas funcionalidades del sitio pueden no
                            estar disponibles.
                        </p>
                        <p>Cómo gestionar cookies en los principales navegadores:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>
                                <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                    Google Chrome
                                </a>
                            </li>
                            <li>
                                <a href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web-rastrear-preferencias" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                    Mozilla Firefox
                                </a>
                            </li>
                            <li>
                                <a href="https://support.apple.com/es-es/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                    Safari
                                </a>
                            </li>
                            <li>
                                <a href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                    Microsoft Edge
                                </a>
                            </li>
                        </ul>

                        <h2 className="text-xl font-semibold text-ivory mt-8">4. Contacto</h2>
                        <p>
                            Si tienes alguna pregunta sobre nuestra política de cookies, puedes contactarnos en{' '}
                            <a href="mailto:info@focusclubvallecas.com" className="text-accent hover:underline">
                                info@focusclubvallecas.com
                            </a>.
                        </p>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
}
