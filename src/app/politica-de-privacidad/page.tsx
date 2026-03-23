'use client';

import Link from 'next/link';
import { Shield, ArrowLeft } from 'lucide-react';
import { PremiumButton } from '@/components/ui/premium-button';
import { GlassCard } from '@/components/ui/glass-card';

export default function PoliticaDePrivacidadPage() {
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
                            <Shield className="w-6 h-6 text-primary" />
                        </div>
                        <h1 className="text-3xl font-bold text-ivory">Política de Privacidad</h1>
                    </div>

                    <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">
                        <p className="text-ivory/80">
                            <strong>Última actualización:</strong> Febrero 2026
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">1. Responsable del Tratamiento</h2>
                        <p>
                            <strong>Focus Club Vallecas</strong><br />
                            Dirección: Vallecas, Madrid, España<br />
                            Email: info@focusclubvallecas.com
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">2. Datos que Recopilamos</h2>
                        <p>
                            Recopilamos los datos personales que nos proporcionas voluntariamente al registrarte en nuestra plataforma,
                            solicitar una cita o contactarnos a través de nuestros formularios. Estos datos pueden incluir:
                        </p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Nombre y apellidos</li>
                            <li>Dirección de correo electrónico</li>
                            <li>Número de teléfono</li>
                            <li>Información relativa a tus objetivos deportivos y estado de salud (cuando la proporcionas voluntariamente)</li>
                        </ul>

                        <h2 className="text-xl font-semibold text-ivory mt-8">3. Finalidad del Tratamiento</h2>
                        <p>Tus datos personales serán tratados con las siguientes finalidades:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Gestionar tu cuenta de usuario y ofrecerte acceso a nuestros servicios</li>
                            <li>Gestionar las solicitudes de cita y reservas</li>
                            <li>Enviarte comunicaciones relacionadas con tu servicio contratado</li>
                            <li>Mejorar nuestros servicios y la experiencia de usuario</li>
                        </ul>

                        <h2 className="text-xl font-semibold text-ivory mt-8">4. Base Legal</h2>
                        <p>
                            El tratamiento de tus datos se basa en tu consentimiento expreso, otorgado al aceptar esta política
                            durante el proceso de registro o solicitud de cita, conforme al artículo 6.1.a) del Reglamento
                            General de Protección de Datos (RGPD).
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">5. Conservación de los Datos</h2>
                        <p>
                            Tus datos serán conservados mientras mantengas tu relación con Focus Club Vallecas y durante el
                            tiempo necesario para cumplir con las obligaciones legales aplicables.
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">6. Derechos del Interesado</h2>
                        <p>Puedes ejercer los siguientes derechos en cualquier momento:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li><strong>Acceso:</strong> Conocer qué datos tuyos tratamos</li>
                            <li><strong>Rectificación:</strong> Corregir datos inexactos o incompletos</li>
                            <li><strong>Supresión:</strong> Solicitar la eliminación de tus datos</li>
                            <li><strong>Oposición:</strong> Oponerte al tratamiento de tus datos</li>
                            <li><strong>Portabilidad:</strong> Recibir tus datos en formato estructurado</li>
                        </ul>
                        <p>
                            Para ejercer tus derechos, contacta con nosotros en{' '}
                            <a href="mailto:info@focusclubvallecas.com" className="text-accent hover:underline">
                                info@focusclubvallecas.com
                            </a>.
                        </p>

                        <h2 className="text-xl font-semibold text-ivory mt-8">7. Seguridad de los Datos</h2>
                        <p>
                            Implementamos medidas de seguridad técnicas y organizativas apropiadas para proteger tus datos
                            personales contra acceso no autorizado, pérdida o destrucción. Utilizamos Firebase Authentication
                            y Firestore con cifrado en tránsito y en reposo.
                        </p>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
}
