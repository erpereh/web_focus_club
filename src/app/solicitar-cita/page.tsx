'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Dumbbell,
  Activity,
  Heart,
  Apple,
  Clock,
  Calendar,
  User,
  Mail,
  Phone,
  MessageSquare,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  Trophy,
  Loader2,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { addAppointment as addAppointmentFS, getSiteConfig, generateTimeSlots } from '@/lib/firestore';
import { TimeSlot } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

const serviceTypes = [
  {
    id: 'training',
    title: 'Entrenamiento Personal',
    description: 'Programas personalizados con metodología científica',
    icon: Dumbbell,
  },
  {
    id: 'competition',
    title: 'Preparación para Competición',
    description: 'Para atletas que buscan competir',
    icon: Trophy,
  },
  {
    id: 'nutrition',
    title: 'Nutrición y Recomposición',
    description: 'Planes nutricionales personalizados',
    icon: Apple,
  },
  {
    id: 'assessment',
    title: 'Valoración Inicial',
    description: 'Evaluación completa - ¡Gratis!',
    icon: Activity,
  },
];

const durations = [
  { value: '30', label: '30 minutos', desc: 'Consulta rápida' },
  { value: '60', label: '60 minutos', desc: 'Sesión estándar' },
  { value: '90', label: '90 minutos', desc: 'Sesión extendida' },
] as const;

const steps = [
  { id: 1, title: 'Tipo de cita' },
  { id: 2, title: 'Duración' },
  { id: 3, title: 'Franjas horarias' },
  { id: 4, title: 'Tus datos' },
  { id: 5, title: 'Confirmación' },
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

export default function SolicitarCitaPage() {
  const router = useRouter();
  const { user, userProfile, loading: authLoading } = useAuth();
  const isAuthenticated = !!user && !!userProfile?.phone;

  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(0);

  const [formData, setFormData] = useState({
    serviceType: '',
    duration: '60' as '30' | '60' | '90',
    preferredSlots: [] as TimeSlot[],
    name: '',
    email: '',
    phone: '',
    reason: '',
  });

  const [newSlot, setNewSlot] = useState<TimeSlot>({ date: '', time: '' });
  const [submitted, setSubmitted] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [timeSlots, setTimeSlots] = useState<string[]>([]);

  // ============================================
  // AUTH GUARD: redirigir a /portal si no autenticado
  // ============================================
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/portal');
    }
  }, [authLoading, isAuthenticated, router]);

  // Pre-rellenar datos del usuario autenticado
  useEffect(() => {
    if (userProfile) {
      setFormData(prev => ({
        ...prev,
        name: userProfile.name || '',
        email: userProfile.email || '',
        phone: userProfile.phone || '',
      }));
    }
  }, [userProfile]);

  // Load dynamic time slots from config
  useEffect(() => {
    getSiteConfig().then((config) => {
      setTimeSlots(generateTimeSlots(config));
    });
  }, []);

  // Mostrar loading mientras se comprueba la autenticación
  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  const handleNext = () => {
    setDirection(1);
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    setDirection(-1);
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return formData.serviceType !== '';
      case 2:
        return (formData.duration as string) !== '';
      case 3:
        return formData.preferredSlots.length >= 1;
      case 4:
        return formData.name && formData.email && formData.phone && acceptedPrivacy;
      default:
        return true;
    }
  };

  const addTimeSlot = () => {
    if (newSlot.date && newSlot.time) {
      setFormData((prev) => ({
        ...prev,
        preferredSlots: [...prev.preferredSlots, { ...newSlot }],
      }));
      setNewSlot({ date: '', time: '' });
    }
  };

  const removeTimeSlot = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      preferredSlots: prev.preferredSlots.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async () => {
    try {
      await addAppointmentFS({
        userId: user?.uid || 'anonymous',
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        serviceType: formData.serviceType,
        duration: formData.duration,
        preferredSlots: formData.preferredSlots,
        reason: formData.reason,
      });
      setSubmitted(true);
    } catch (error) {
      console.error('Error al solicitar cita:', error);
    }
  };

  const selectedService = serviceTypes.find((s) => s.id === formData.serviceType);
  const selectedDuration = durations.find((d) => d.value === formData.duration);

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <motion.div
          className="max-w-md w-full text-center"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <GlassCard className="p-8">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-ivory mb-3">
              ¡Solicitud enviada!
            </h1>
            <p className="text-muted-foreground mb-6">
              Hemos recibido tu solicitud. Te contactaremos en las próximas 24 horas para confirmar tu cita.
            </p>
            <Link href="/">
              <PremiumButton variant="cta">
                Volver al inicio
              </PremiumButton>
            </Link>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4">
        {/* Progress Steps */}
        <motion.div
          className="max-w-3xl mx-auto mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between relative">
            {/* Progress line */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted" />
            <div
              className="absolute top-5 left-0 h-0.5 bg-accent transition-all duration-500"
              style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            />

            {steps.map((step) => (
              <div key={step.id} className="relative z-10 flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${currentStep >= step.id
                    ? 'bg-accent text-carbon'
                    : 'bg-muted text-muted-foreground'
                    }`}
                >
                  {currentStep > step.id ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    step.id
                  )}
                </div>
                <span className="text-xs text-muted-foreground mt-2 hidden sm:block">
                  {step.title}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Form Content */}
        <div className="max-w-3xl mx-auto">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              {/* Step 1: Service Type */}
              {currentStep === 1 && (
                <div>
                  <h2 className="text-2xl font-bold text-ivory mb-2">
                    ¿Qué tipo de cita necesitas?
                  </h2>
                  <p className="text-muted-foreground mb-8">
                    Selecciona el servicio que mejor se adapte a tus necesidades.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {serviceTypes.map((service) => (
                      <motion.div
                        key={service.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <GlassCard
                          className={`cursor-pointer transition-all ${formData.serviceType === service.id
                            ? 'border-accent shadow-emerald-glow'
                            : ''
                            }`}
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              serviceType: service.id,
                            }))
                          }
                        >
                          <div className="flex items-start gap-4">
                            <div
                              className={`w-12 h-12 rounded-xl flex items-center justify-center ${formData.serviceType === service.id
                                ? 'bg-accent/20'
                                : 'bg-primary/20'
                                }`}
                            >
                              <service.icon
                                className={`w-6 h-6 ${formData.serviceType === service.id
                                  ? 'text-accent'
                                  : 'text-muted-foreground'
                                  }`}
                              />
                            </div>
                            <div>
                              <h3 className="font-semibold text-ivory">
                                {service.title}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {service.description}
                              </p>
                            </div>
                          </div>
                        </GlassCard>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Duration */}
              {currentStep === 2 && (
                <div>
                  <h2 className="text-2xl font-bold text-ivory mb-2">
                    ¿Cuánto tiempo necesitas?
                  </h2>
                  <p className="text-muted-foreground mb-8">
                    Selecciona la duración de tu sesión.
                  </p>
                  <div className="grid sm:grid-cols-3 gap-4">
                    {durations.map((dur) => (
                      <motion.div
                        key={dur.value}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <GlassCard
                          className={`cursor-pointer text-center transition-all ${formData.duration === dur.value
                            ? 'border-accent shadow-emerald-glow'
                            : ''
                            }`}
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              duration: dur.value,
                            }))
                          }
                        >
                          <div className="flex items-center justify-center mb-3">
                            <Clock
                              className={`w-8 h-8 ${formData.duration === dur.value
                                ? 'text-accent'
                                : 'text-muted-foreground'
                                }`}
                            />
                          </div>
                          <h3 className="text-xl font-bold text-ivory">
                            {dur.label}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {dur.desc}
                          </p>
                        </GlassCard>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Time Slots */}
              {currentStep === 3 && (
                <div>
                  <h2 className="text-2xl font-bold text-ivory mb-2">
                    Propón tus franjas horarias
                  </h2>
                  <p className="text-muted-foreground mb-8">
                    Añade al menos 1 franja horaria. Puedes añadir hasta 3 opciones.
                  </p>

                  {/* Existing slots */}
                  {formData.preferredSlots.length > 0 && (
                    <div className="mb-6 space-y-3">
                      {formData.preferredSlots.map((slot, index) => (
                        <GlassCard key={index} className="flex flex-wrap items-center justify-between gap-2 p-4">
                          <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-accent" />
                            <span className="text-ivory">
                              {new Date(slot.date).toLocaleDateString('es-ES', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                              })}
                            </span>
                            <span className="text-muted-foreground">•</span>
                            <span className="text-accent font-medium">{slot.time}</span>
                          </div>
                          <button
                            onClick={() => removeTimeSlot(index)}
                            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </GlassCard>
                      ))}
                    </div>
                  )}

                  {/* Add new slot */}
                  {formData.preferredSlots.length < 3 && (
                    <GlassCard className="p-6">
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm text-muted-foreground mb-2">
                            Fecha
                          </label>
                          <input
                            type="date"
                            value={newSlot.date}
                            onChange={(e) =>
                              setNewSlot((prev) => ({
                                ...prev,
                                date: e.target.value,
                              }))
                            }
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-muted-foreground mb-2">
                            Hora
                          </label>
                          <select
                            value={newSlot.time}
                            onChange={(e) =>
                              setNewSlot((prev) => ({
                                ...prev,
                                time: e.target.value,
                              }))
                            }
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light"
                          >
                            <option value="">Selecciona hora</option>
                            {timeSlots.map((time) => (
                              <option key={time} value={time}>
                                {time}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end">
                          <PremiumButton
                            variant="outline"
                            onClick={addTimeSlot}
                            disabled={!newSlot.date || !newSlot.time}
                            icon={<Plus className="w-4 h-4" />}
                            className="w-full"
                          >
                            Añadir
                          </PremiumButton>
                        </div>
                      </div>
                    </GlassCard>
                  )}
                </div>
              )}

              {/* Step 4: Personal Data */}
              {currentStep === 4 && (
                <div>
                  <h2 className="text-2xl font-bold text-ivory mb-2">
                    Tus datos de contacto
                  </h2>
                  <p className="text-muted-foreground mb-8">
                    Necesitamos tus datos para poder contactarte.
                  </p>
                  <GlassCard className="p-6">
                    <div className="space-y-6">
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <User className="w-4 h-4" />
                          Nombre completo
                        </label>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light"
                          placeholder="Tu nombre"
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-6">
                        <div>
                          <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                            <Mail className="w-4 h-4" />
                            Email
                          </label>
                          <input
                            type="email"
                            value={formData.email}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                email: e.target.value,
                              }))
                            }
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light"
                            placeholder="tu@email.com"
                          />
                        </div>
                        <div>
                          <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                            <Phone className="w-4 h-4" />
                            Teléfono
                          </label>
                          <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                phone: e.target.value,
                              }))
                            }
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light"
                            placeholder="+34 600 000 000"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <MessageSquare className="w-4 h-4" />
                          ¿Por qué quieres esta cita? (opcional)
                        </label>
                        <textarea
                          value={formData.reason}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              reason: e.target.value,
                            }))
                          }
                          rows={4}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light resize-none"
                          placeholder="Cuéntanos brevemente sobre tus objetivos o cualquier lesión que tengas..."
                        />
                      </div>
                    </div>

                    {/* RGPD Checkbox */}
                    <label className="flex items-start gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={acceptedPrivacy}
                        onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                        required
                        className="mt-1 w-4 h-4 rounded border-border accent-accent flex-shrink-0"
                      />
                      <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-ivory/70 transition-colors">
                        He leído y acepto la{' '}
                        <Link href="/politica-de-privacidad" className="text-accent hover:underline" target="_blank">
                          Política de Privacidad
                        </Link>{' '}
                        y el tratamiento de mis datos personales.
                      </span>
                    </label>
                  </GlassCard>
                </div>
              )}

              {/* Step 5: Confirmation */}
              {currentStep === 5 && (
                <div>
                  <h2 className="text-2xl font-bold text-ivory mb-2">
                    Confirma tu solicitud
                  </h2>
                  <p className="text-muted-foreground mb-8">
                    Revisa los detalles antes de enviar.
                  </p>
                  <GlassCard className="p-6 space-y-6">
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          Tipo de servicio
                        </span>
                        <p className="text-lg font-semibold text-ivory mt-1">
                          {selectedService?.title}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          Duración
                        </span>
                        <p className="text-lg font-semibold text-ivory mt-1">
                          {selectedDuration?.label}
                        </p>
                      </div>
                    </div>

                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        Franjas propuestas
                      </span>
                      <div className="mt-2 space-y-2">
                        {formData.preferredSlots.map((slot, index) => (
                          <div key={index} className="flex items-center gap-2 text-ivory">
                            <Calendar className="w-4 h-4 text-accent" />
                            <span>
                              {new Date(slot.date).toLocaleDateString('es-ES', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                            <span className="text-muted-foreground">•</span>
                            <span className="text-accent">{slot.time}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-border pt-6">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        Datos de contacto
                      </span>
                      <div className="mt-2 space-y-1">
                        <p className="text-ivory">{formData.name}</p>
                        <p className="text-muted-foreground">{formData.email}</p>
                        <p className="text-muted-foreground">{formData.phone}</p>
                      </div>
                    </div>

                    {formData.reason && (
                      <div className="border-t border-border pt-6">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          Comentario
                        </span>
                        <p className="text-ivory mt-2">{formData.reason}</p>
                      </div>
                    )}
                  </GlassCard>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mt-8">
            <PremiumButton
              variant="ghost"
              onClick={handlePrev}
              disabled={currentStep === 1}
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Anterior
            </PremiumButton>

            {currentStep < 5 ? (
              <PremiumButton
                variant="cta"
                onClick={handleNext}
                disabled={!canProceed()}
                icon={<ArrowRight className="w-4 h-4" />}
                iconPosition="right"
              >
                Siguiente
              </PremiumButton>
            ) : (
              <PremiumButton
                variant="cta"
                onClick={handleSubmit}
                icon={<CheckCircle className="w-4 h-4" />}
                iconPosition="right"
              >
                Enviar Solicitud
              </PremiumButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
