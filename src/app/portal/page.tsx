'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  User,
  Mail,
  Phone,
  Lock,
  LogIn,
  UserPlus,
  LogOut,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Dumbbell,
  Activity,
  Apple,
  Trophy,
  Users,
  Heart,
  AlertCircle,
  Eye,
  EyeOff,
  CalendarPlus,
  MailCheck,
  RefreshCw,
  KeyRound,
  Ticket,
  History,
  X,
  Camera,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { InteractiveCalendar } from '@/components/ui/interactive-calendar';
import { useAuth } from '@/contexts/AuthContext';
import type { TimeSlot, Appointment, Bono } from '@/types';
import { addAppointment as addAppointmentFS, getAppointmentsByUser, getActiveBonoByUser, getBonosByUser, updateUserProfile } from '@/lib/firestore';
import { storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { updatePassword } from 'firebase/auth';
import { cn } from '@/lib/utils';

// ============================================
// TIPOS
// ============================================

type AuthMode = 'login' | 'register' | 'forgot-password' | 'complete-profile';
type PortalView = 'dashboard' | 'new-appointment' | 'appointment-detail';

interface FormData {
  serviceType: string;
  duration: '30' | '60' | '90';
  preferredSlot: TimeSlot | null;
  reason: string;
}

// ============================================
// CONFIGURACIÓN DE ESTADOS
// ============================================

const statusConfig = {
  pending: {
    label: 'Pendiente',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    icon: Clock,
    description: 'Tu solicitud está siendo revisada',
  },
  approved: {
    label: 'Aprobada',
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    icon: CheckCircle,
    description: '¡Tu cita ha sido confirmada!',
  },
  rejected: {
    label: 'Rechazada',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
    icon: XCircle,
    description: 'La solicitud no pudo ser atendida',
  },
};

// Fallback labels for appointments created before dynamic loading
const serviceLabels: Record<string, string> = {
  training: 'Entrenamiento Personal',
  competition: 'Preparación para Competición',
  nutrition: 'Nutrición y Recomposición',
  assessment: 'Valoración Inicial',
};

const ICON_MAP: Record<string, LucideIcon> = {
  Dumbbell, Trophy, Apple, Activity, Users, Heart,
};

const durations = [
  { value: '30', label: '30 minutos', desc: 'Consulta rápida' },
  { value: '60', label: '60 minutos', desc: 'Sesión estándar' },
  { value: '90', label: '90 minutos', desc: 'Sesión extendida' },
] as const;

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export default function PortalPage() {
  const { user, userProfile, loading: authContextLoading, login, register, loginWithGoogle, logout, resetPassword, resendVerification, completeGoogleProfile, refreshUserProfile } = useAuth();
  const isAuthenticated = !!user && !!userProfile?.phone;

  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [portalView, setPortalView] = useState<PortalView>('dashboard');
  const [selectedAppointment, setSelectedAppointment] = useState<string | null>(null);

  // Estado del formulario de auth
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);

  // Estado para completar perfil Google
  const [profileForm, setProfileForm] = useState({ name: '', phone: '' });

  // Estado del formulario de citas
  const [formData, setFormData] = useState<FormData>({
    serviceType: '',
    duration: '60',
    preferredSlot: null,
    reason: '',
  });
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Obtener citas del usuario desde Firestore
  const [userAppointments, setUserAppointments] = useState<Appointment[]>([]);

  // Bono state
  const [activeBono, setActiveBono] = useState<Bono | null>(null);
  const [bonoLoading, setBonoLoading] = useState(true);
  const [allBonos, setAllBonos] = useState<Bono[]>([]);

  // Estado de drawers/modales del dashboard
  const [showReservaDrawer, setShowReservaDrawer] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeHistoryTab, setActiveHistoryTab] = useState<'citas' | 'bonos'>('citas');

  // Estado del modal de perfil
  const [profileEditForm, setProfileEditForm] = useState({ name: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('');

  // Derivados del bono activo — determinan servicio y duración de la cita
  const bonoServiceLabel = activeBono
    ? activeBono.tipo === 'sesion_personal'
      ? 'Sesión de Entrenamiento Personal'
      : 'Bono Mensual de Entrenamiento'
    : '';
  const bonoDurationValue: '30' | '60' = activeBono?.modalidad === '30min' ? '30' : '60';

  useEffect(() => {
    if (user) {
      getAppointmentsByUser(user.uid).then(setUserAppointments).catch(console.error);
      // Load bono data
      (async () => {
        try {
          const bono = await getActiveBonoByUser(user.uid);
          // Comprobación de expiración en cliente (sin escribir a Firestore)
          if (bono && new Date(bono.fechaExpiracion) < new Date()) {
            setActiveBono({ ...bono, estado: 'expirado' });
          } else {
            setActiveBono(bono);
          }
          const bonos = await getBonosByUser(user.uid);
          setAllBonos(bonos);
        } catch (err) {
          console.error('Error loading bono:', err);
        } finally {
          setBonoLoading(false);
        }
      })();
    }
  }, [user]);

  // Sincronizar form de perfil al cargar userProfile
  useEffect(() => {
    if (userProfile) {
      setProfileEditForm({ name: userProfile.name || '', phone: userProfile.phone || '' });
    }
  }, [userProfile]);

  // Computed: sesiones totales históricas y próxima cita
  const totalSessionsUsed = allBonos.reduce((sum, b) => sum + (b.sesionesTotales - b.sesionesRestantes), 0);
  const nextAppointment = [...userAppointments]
    .filter(a => a.status === 'pending' || a.status === 'approved')
    .sort((a, b) => {
      const dateA = a.preferredSlots[0]?.date || a.createdAt;
      const dateB = b.preferredSlots[0]?.date || b.createdAt;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    })[0] || null;

  // ============================================
  // MANEJADORES DE AUTENTICACIÓN
  // ============================================

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');
    setNeedsVerification(false);

    const result = await login(authForm.email, authForm.password);

    if (!result.success) {
      setAuthError(result.message);
      if (result.needsVerification) {
        setNeedsVerification(true);
      }
    }

    setAuthLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    if (authForm.password !== authForm.confirmPassword) {
      setAuthError('Las contraseñas no coinciden');
      setAuthLoading(false);
      return;
    }

    if (authForm.password.length < 6) {
      setAuthError('La contraseña debe tener al menos 6 caracteres');
      setAuthLoading(false);
      return;
    }

    if (!acceptedPrivacy) {
      setAuthError('Debes aceptar la Política de Privacidad para registrarte');
      setAuthLoading(false);
      return;
    }

    const result = await register(authForm.email, authForm.password, authForm.name, authForm.phone);

    if (result.success) {
      setAuthSuccess(result.message);
      setAuthMode('login');
    } else {
      setAuthError(result.message);
    }

    setAuthLoading(false);
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    const result = await loginWithGoogle();

    if (result.success && result.needsProfile) {
      // Pre-rellenar con datos de Google
      setProfileForm({
        name: user?.displayName || userProfile?.name || '',
        phone: '',
      });
      setAuthMode('complete-profile');
    } else if (!result.success) {
      setAuthError(result.message);
    }

    setAuthLoading(false);
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    if (!profileForm.phone.trim()) {
      setAuthError('El teléfono es obligatorio');
      setAuthLoading(false);
      return;
    }

    const result = await completeGoogleProfile(profileForm.name, profileForm.phone);

    if (!result.success) {
      setAuthError(result.message);
    }
    // Si success, isAuthenticated pasará a true automáticamente (userProfile.phone ya no es vacío)

    setAuthLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    const result = await resetPassword(authForm.email);

    if (result.success) {
      setAuthSuccess(result.message);
    } else {
      setAuthError(result.message);
    }

    setAuthLoading(false);
  };

  const handleResendVerification = async () => {
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    const result = await resendVerification();

    if (result.success) {
      setAuthSuccess(result.message);
      setNeedsVerification(false);
    } else {
      setAuthError(result.message);
    }

    setAuthLoading(false);
  };

  // ============================================
  // APPOINTMENT HANDLERS
  // ============================================

  const handleSelectSlot = (slot: TimeSlot) => {
    setFormData(prev => ({ ...prev, preferredSlot: slot }));
  };

  const handleClearSlot = () => {
    setFormData(prev => ({ ...prev, preferredSlot: null }));
  };

  const handleSubmitAppointment = async () => {
    if (!user || !userProfile || !formData.preferredSlot) return;

    // Verificar bono activo con sesiones disponibles
    const currentBono = await getActiveBonoByUser(user.uid);
    if (!currentBono || currentBono.sesionesRestantes <= 0) {
      alert('No tienes sesiones disponibles en tu bono. Consulta en el gimnasio para renovar o adquirir un bono.');
      return;
    }

    try {
      await addAppointmentFS({
        userId: user.uid,
        name: userProfile.name,
        email: userProfile.email,
        phone: userProfile.phone || '',
        serviceType: bonoServiceLabel,
        duration: bonoDurationValue,
        preferredSlots: [formData.preferredSlot],
        reason: formData.reason,
      });

      // Refrescar citas
      const updated = await getAppointmentsByUser(user.uid);
      setUserAppointments(updated);

      setSubmitSuccess(true);
      setTimeout(() => {
        setSubmitSuccess(false);
        setFormData({
          serviceType: '',
          duration: '60',
          preferredSlot: null,
          reason: '',
        });
        setShowReservaDrawer(false);
      }, 2000);
    } catch (error) {
      console.error('Error al crear cita:', error);
    }
  };

  // ============================================
  // PERFIL HANDLER
  // ============================================

  const handleSaveProfile = async () => {
    if (!user || !userProfile) return;
    if (newPassword.length > 0 && newPassword.length < 6) {
      setProfileError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setProfileSaving(true);
    setProfileError('');
    setProfileSuccess('');
    try {
      let photoURL = userProfile.photoURL || '';
      if (profilePhotoFile) {
        const storageRef = ref(storage, `user-avatars/${user.uid}`);
        await uploadBytes(storageRef, profilePhotoFile);
        photoURL = await getDownloadURL(storageRef);
      }
      await updateUserProfile(user.uid, {
        name: profileEditForm.name,
        phone: profileEditForm.phone,
        ...(photoURL ? { photoURL } : {}),
      });
      if (newPassword.length >= 6) {
        await updatePassword(user, newPassword);
        setNewPassword('');
      }
      await refreshUserProfile();
      setProfilePhotoFile(null);
      setProfilePhotoPreview('');
      setProfileSuccess('Perfil actualizado correctamente.');
    } catch (err) {
      console.error(err);
      setProfileError('Error al guardar los cambios. Si usas Google, puede que necesites reautenticarte.');
    } finally {
      setProfileSaving(false);
    }
  };

  // ============================================
  // RENDER - AUTH SCREEN
  // ============================================

  if (!isAuthenticated) {
    return (
      <div className="h-screen -mt-20 flex items-center justify-center px-4">
        <motion.div
          className="max-w-md w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard className="p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald to-accent mx-auto mb-4 flex items-center justify-center">
                {authMode === 'complete-profile' ? (
                  <UserPlus className="w-8 h-8 text-obsidian" />
                ) : authMode === 'forgot-password' ? (
                  <KeyRound className="w-8 h-8 text-obsidian" />
                ) : (
                  <User className="w-8 h-8 text-obsidian" />
                )}
              </div>
              <h1 className="text-2xl font-bold text-ivory mb-2">
                {authMode === 'complete-profile'
                  ? 'Completa tu Perfil'
                  : authMode === 'forgot-password'
                    ? 'Recuperar Contraseña'
                    : 'Portal del Cliente'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {authMode === 'complete-profile'
                  ? 'Necesitamos algunos datos más'
                  : authMode === 'forgot-password'
                    ? 'Te enviaremos un enlace para restablecer tu contraseña'
                    : 'Focus Club Vallecas'}
              </p>
            </div>

            {/* ============================================
                COMPLETE PROFILE VIEW (Google first-time)
                ============================================ */}
            {authMode === 'complete-profile' && (
              <motion.form
                key="complete-profile"
                onSubmit={handleCompleteProfile}
                className="space-y-4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <User className="w-4 h-4" />
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                    placeholder="Tu nombre"
                    required
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Phone className="w-4 h-4" />
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                    placeholder="+34 600 000 000"
                    required
                  />
                </div>

                {authError && (
                  <p className="text-destructive text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {authError}
                  </p>
                )}

                <PremiumButton
                  type="submit"
                  variant="cta"
                  className="w-full"
                  loading={authLoading}
                  icon={<CheckCircle className="w-4 h-4" />}
                >
                  Guardar y Continuar
                </PremiumButton>
              </motion.form>
            )}

            {/* ============================================
                FORGOT PASSWORD VIEW
                ============================================ */}
            {authMode === 'forgot-password' && (
              <motion.form
                key="forgot-password"
                onSubmit={handleForgotPassword}
                className="space-y-4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Mail className="w-4 h-4" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                    placeholder="tu@email.com"
                    required
                  />
                </div>

                {authError && (
                  <p className="text-destructive text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {authError}
                  </p>
                )}

                {authSuccess && (
                  <p className="text-emerald-400 text-sm flex items-center gap-2">
                    <MailCheck className="w-4 h-4" />
                    {authSuccess}
                  </p>
                )}

                <PremiumButton
                  type="submit"
                  variant="cta"
                  className="w-full"
                  loading={authLoading}
                  icon={<Mail className="w-4 h-4" />}
                >
                  Enviar enlace
                </PremiumButton>

                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccess(''); }}
                  className="w-full text-center text-sm text-muted-foreground hover:text-ivory transition-colors mt-2"
                >
                  Volver al inicio de sesión
                </button>
              </motion.form>
            )}

            {/* ============================================
                LOGIN / REGISTER VIEWS
                ============================================ */}
            {(authMode === 'login' || authMode === 'register') && (
              <>
                {/* Tab Switcher */}
                <div className="flex bg-forest-deep/30 rounded-xl p-1 mb-6">
                  <button
                    onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccess(''); setNeedsVerification(false); }}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm font-medium transition-all',
                      authMode === 'login'
                        ? 'bg-emerald text-ivory'
                        : 'text-muted-foreground hover:text-ivory'
                    )}
                  >
                    Iniciar Sesión
                  </button>
                  <button
                    onClick={() => { setAuthMode('register'); setAuthError(''); setAuthSuccess(''); setNeedsVerification(false); }}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm font-medium transition-all',
                      authMode === 'register'
                        ? 'bg-emerald text-ivory'
                        : 'text-muted-foreground hover:text-ivory'
                    )}
                  >
                    Registrarse
                  </button>
                </div>

                {/* Success message (tras registro, tras reenviar verificación) */}
                {authSuccess && (
                  <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                    <p className="text-emerald-400 text-sm flex items-center gap-2">
                      <MailCheck className="w-4 h-4 flex-shrink-0" />
                      {authSuccess}
                    </p>
                  </div>
                )}

                {/* Forms */}
                <AnimatePresence mode="wait">
                  {authMode === 'login' ? (
                    <motion.form
                      key="login"
                      onSubmit={handleLogin}
                      className="space-y-4"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                    >
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Mail className="w-4 h-4" />
                          Email
                        </label>
                        <input
                          type="email"
                          value={authForm.email}
                          onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                          placeholder="tu@email.com"
                          required
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Lock className="w-4 h-4" />
                          Contraseña
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={authForm.password}
                            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light pr-12"
                            placeholder="••••••••"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ivory"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Forgot password link */}
                      <div className="text-right">
                        <button
                          type="button"
                          onClick={() => { setAuthMode('forgot-password'); setAuthError(''); setAuthSuccess(''); }}
                          className="text-xs text-muted-foreground hover:text-accent transition-colors"
                        >
                          ¿Has olvidado tu contraseña?
                        </button>
                      </div>

                      {authError && (
                        <div className="space-y-2">
                          <p className="text-destructive text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {authError}
                          </p>
                          {needsVerification && (
                            <button
                              type="button"
                              onClick={handleResendVerification}
                              disabled={authLoading}
                              className="text-sm text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
                            >
                              <RefreshCw className={cn("w-3 h-3", authLoading && "animate-spin")} />
                              Reenviar email de verificación
                            </button>
                          )}
                        </div>
                      )}

                      <PremiumButton
                        type="submit"
                        variant="cta"
                        className="w-full"
                        loading={authLoading}
                        icon={<LogIn className="w-4 h-4" />}
                      >
                        Entrar
                      </PremiumButton>

                      {/* Separator */}
                      <div className="flex items-center gap-3 my-2 text-xs text-muted-foreground">
                        <div className="flex-1 border-t border-border" />
                        <span>o</span>
                        <div className="flex-1 border-t border-border" />
                      </div>

                      {/* Google Sign-In */}
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={authLoading}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-border bg-input hover:bg-border/50 text-ivory text-sm font-medium transition-all disabled:opacity-50"
                      >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Continuar con Google
                      </button>
                    </motion.form>
                  ) : (
                    <motion.form
                      key="register"
                      onSubmit={handleRegister}
                      className="space-y-4"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                    >
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <User className="w-4 h-4" />
                          Nombre completo
                        </label>
                        <input
                          type="text"
                          value={authForm.name}
                          onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                          placeholder="Tu nombre"
                          required
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Mail className="w-4 h-4" />
                          Email
                        </label>
                        <input
                          type="email"
                          value={authForm.email}
                          onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                          placeholder="tu@email.com"
                          required
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Phone className="w-4 h-4" />
                          Teléfono
                        </label>
                        <input
                          type="tel"
                          value={authForm.phone}
                          onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                          placeholder="+34 600 000 000"
                          required
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Lock className="w-4 h-4" />
                          Contraseña
                        </label>
                        <input
                          type="password"
                          value={authForm.password}
                          onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                          placeholder="••••••••"
                          required
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                          <Lock className="w-4 h-4" />
                          Confirmar contraseña
                        </label>
                        <input
                          type="password"
                          value={authForm.confirmPassword}
                          onChange={(e) => setAuthForm({ ...authForm, confirmPassword: e.target.value })}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light"
                          placeholder="••••••••"
                          required
                        />
                      </div>

                      {authError && (
                        <p className="text-destructive text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {authError}
                        </p>
                      )}

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

                      <PremiumButton
                        type="submit"
                        variant="cta"
                        className="w-full"
                        loading={authLoading}
                        icon={<UserPlus className="w-4 h-4" />}
                      >
                        Crear Cuenta
                      </PremiumButton>

                      {/* Separator */}
                      <div className="flex items-center gap-3 my-2 text-xs text-muted-foreground">
                        <div className="flex-1 border-t border-border" />
                        <span>o</span>
                        <div className="flex-1 border-t border-border" />
                      </div>

                      {/* Google Sign-In */}
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={authLoading}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-border bg-input hover:bg-border/50 text-ivory text-sm font-medium transition-all disabled:opacity-50"
                      >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Continuar con Google
                      </button>
                    </motion.form>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* Back link — solo si no es complete-profile */}
            {authMode !== 'complete-profile' && (
              <Link href="/" className="block text-center mt-6">
                <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                  Volver al inicio
                </PremiumButton>
              </Link>
            )}
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // ============================================
  // RENDER - AUTHENTICATED PORTAL
  // ============================================

  return (
    <div className="min-h-screen -mt-20">
      {/* Header */}
      <header className="glass-dark border-b border-border sticky top-0 z-40">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald to-accent flex items-center justify-center">
                <Dumbbell className="w-4 h-4 text-obsidian" />
              </div>
              <span className="font-bold text-ivory hidden sm:block">Focus Club</span>
            </Link>

            <div className="flex items-center gap-2">
              <Link href="/">
                <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                  <span className="hidden sm:inline">Ver web</span>
                </PremiumButton>
              </Link>
              <PremiumButton
                variant="ghost"
                size="sm"
                onClick={logout}
                icon={<LogOut className="w-4 h-4" />}
              >
                <span className="hidden sm:inline">Salir</span>
              </PremiumButton>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {/* ============================================
              DASHBOARD VIEW
              ============================================ */}
          {portalView === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {/* Header bar: avatar + CTA */}
              <div className="flex items-center justify-between mb-8 gap-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowProfileModal(true)} className="relative group shrink-0">
                    {userProfile?.photoURL ? (
                      <img src={userProfile.photoURL} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-accent/40 group-hover:ring-accent transition-all" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald to-accent flex items-center justify-center text-obsidian font-bold text-lg group-hover:scale-105 transition-transform">
                        {userProfile?.name?.charAt(0)}
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-obsidian border border-border flex items-center justify-center">
                      <Settings className="w-2.5 h-2.5 text-muted-foreground" />
                    </span>
                  </button>
                  <div>
                    <p className="font-bold text-ivory leading-tight">{userProfile?.name}</p>
                    <p className="text-xs text-muted-foreground">{userProfile?.email}</p>
                  </div>
                </div>

                {!bonoLoading && activeBono && activeBono.sesionesRestantes > 0 && (
                  <PremiumButton
                    variant="cta"
                    icon={<CalendarPlus className="w-4 h-4" />}
                    iconPosition="right"
                    onClick={() => setShowReservaDrawer(true)}
                    className="shrink-0"
                  >
                    Reservar Sesión
                  </PremiumButton>
                )}
              </div>

              {/* Sin bono activo — aviso */}
              {!bonoLoading && (!activeBono || activeBono.sesionesRestantes <= 0) && (
                <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  No tienes sesiones disponibles. Consulta en el gimnasio para adquirir o renovar tu bono.
                </div>
              )}

              {/* 3-card summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {/* Mi Bono */}
                <GlassCard className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-accent" />
                      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Mi Bono</span>
                    </div>
                    {activeBono && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald/10 text-emerald border border-emerald/20 font-medium">
                        Activo
                      </span>
                    )}
                  </div>
                  {bonoLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Cargando...</span>
                    </div>
                  ) : activeBono ? (
                    <>
                      <p className="text-ivory font-semibold text-lg mb-1">
                        {activeBono.tipo === 'bono_mensual' ? 'Bono Mensual' : 'Sesión Personal'}
                      </p>
                      <div className="mt-2 mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>Sesiones</span>
                        <span className="text-ivory font-medium">{activeBono.sesionesRestantes}/{activeBono.sesionesTotales}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald to-accent transition-all"
                          style={{ width: `${(activeBono.sesionesRestantes / activeBono.sesionesTotales) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Válido hasta {new Date(activeBono.fechaExpiracion).toLocaleDateString('es-ES')}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">Sin bono activo</p>
                  )}
                </GlassCard>

                {/* Próxima Cita */}
                <GlassCard className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-accent" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Próxima Cita</span>
                  </div>
                  {nextAppointment ? (
                    <>
                      <p className="text-ivory font-semibold text-lg mb-1">
                        {nextAppointment.preferredSlots[0]
                          ? new Date(nextAppointment.preferredSlots[0].date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                          : '—'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {nextAppointment.preferredSlots[0]?.time || ''}
                      </p>
                      <span className={cn('inline-flex items-center gap-1 mt-2 text-xs px-2 py-0.5 rounded-full border', statusConfig[nextAppointment.status].color)}>
                        {nextAppointment.status === 'pending' ? 'Pendiente' : 'Confirmada'}
                      </span>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">Sin citas próximas</p>
                  )}
                </GlassCard>

                {/* Sesiones Realizadas */}
                <GlassCard className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-accent" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sesiones Realizadas</span>
                  </div>
                  <p className="text-4xl font-bold text-ivory">{totalSessionsUsed}</p>
                  <p className="text-xs text-muted-foreground mt-1">sesiones totales completadas</p>
                </GlassCard>
              </div>

              {/* Two-column layout */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left: Mis Citas (pending + approved) */}
                <div className="lg:col-span-3 space-y-4">
                  <h2 className="text-lg font-semibold text-ivory">Mis Citas</h2>
                  {userAppointments.filter(a => a.status === 'pending' || a.status === 'approved').length === 0 ? (
                    <GlassCard className="p-8 text-center">
                      <Calendar className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                      <p className="text-ivory font-medium mb-1">Sin citas activas</p>
                      <p className="text-sm text-muted-foreground">Reserva una sesión para empezar</p>
                    </GlassCard>
                  ) : (
                    userAppointments.filter(a => a.status === 'pending' || a.status === 'approved').map((appt) => {
                      const status = statusConfig[appt.status];
                      const StatusIcon = status.icon;
                      return (
                        <GlassCard
                          key={appt.id}
                          className="p-5 cursor-pointer hover:border-accent/40 transition-all"
                          onClick={() => { setSelectedAppointment(appt.id); setPortalView('appointment-detail'); }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', appt.status === 'approved' ? 'bg-emerald/20' : 'bg-muted/30')}>
                                <Calendar className={cn('w-5 h-5', appt.status === 'approved' ? 'text-accent' : 'text-muted-foreground')} />
                              </div>
                              <div>
                                <p className="font-medium text-ivory text-sm">{serviceLabels[appt.serviceType] || appt.serviceType}</p>
                                <p className="text-xs text-muted-foreground">
                                  {appt.preferredSlots[0]
                                    ? `${new Date(appt.preferredSlots[0].date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${appt.preferredSlots[0].time}`
                                    : '—'}
                                </p>
                              </div>
                            </div>
                            <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-obsidian/50 shrink-0', status.color)}>
                              <StatusIcon className="w-3 h-3" />
                              {status.label}
                            </span>
                          </div>
                        </GlassCard>
                      );
                    })
                  )}
                </div>

                {/* Right: Historial con tabs */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/20 border border-white/5">
                    {(['citas', 'bonos'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setActiveHistoryTab(tab)}
                        className={cn(
                          'flex-1 py-1.5 rounded-lg text-xs font-medium transition-all',
                          activeHistoryTab === tab ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-ivory'
                        )}
                      >
                        {tab === 'citas' ? 'Historial Citas' : 'Historial Bonos'}
                      </button>
                    ))}
                  </div>

                  {activeHistoryTab === 'citas' && (
                    <div className="space-y-2">
                      {userAppointments.filter(a => a.status === 'rejected').length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Sin historial de citas</p>
                      ) : userAppointments.filter(a => a.status === 'rejected').map((appt) => {
                        const status = statusConfig[appt.status];
                        const StatusIcon = status.icon;
                        return (
                          <GlassCard
                            key={appt.id}
                            className="p-4 cursor-pointer hover:border-accent/30 transition-all"
                            onClick={() => { setSelectedAppointment(appt.id); setPortalView('appointment-detail'); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-ivory text-xs font-medium">{serviceLabels[appt.serviceType] || appt.serviceType}</p>
                                <p className="text-xs text-muted-foreground">
                                  {appt.preferredSlots[0]
                                    ? `${new Date(appt.preferredSlots[0].date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${appt.preferredSlots[0].time}`
                                    : new Date(appt.createdAt).toLocaleDateString('es-ES')}
                                </p>
                              </div>
                              <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border shrink-0', status.color)}>
                                <StatusIcon className="w-2.5 h-2.5" />
                                {status.label}
                              </span>
                            </div>
                          </GlassCard>
                        );
                      })}
                    </div>
                  )}

                  {activeHistoryTab === 'bonos' && (
                    <div className="space-y-2">
                      {allBonos.filter(b => b.estado !== 'activo').length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Sin historial de bonos</p>
                      ) : allBonos.filter(b => b.estado !== 'activo').map((bono) => {
                        const usadas = bono.sesionesTotales - bono.sesionesRestantes;
                        const estadoBadge =
                          bono.estado === 'agotado' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                          bono.estado === 'expirado' ? 'bg-muted/20 text-muted-foreground border-muted/20' :
                          'bg-red-500/10 text-red-400 border-red-500/20';
                        return (
                          <GlassCard key={bono.id} className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-ivory text-xs font-medium">
                                  {bono.tipo === 'bono_mensual' ? 'Bono Mensual' : 'Sesión Personal'}
                                  {bono.modalidad ? ` · ${bono.modalidad}` : ''}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {new Date(bono.fechaAsignacion).toLocaleDateString('es-ES')} → {new Date(bono.fechaExpiracion).toLocaleDateString('es-ES')}
                                </p>
                                <p className="text-xs text-muted-foreground">{usadas}/{bono.sesionesTotales} sesiones usadas</p>
                              </div>
                              <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium shrink-0', estadoBadge)}>
                                {bono.estado.charAt(0).toUpperCase() + bono.estado.slice(1)}
                              </span>
                            </div>
                          </GlassCard>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ============================================
              APPOINTMENT DETAIL VIEW
              ============================================ */}
          {portalView === 'appointment-detail' && selectedAppointment && (
            <motion.div
              key="appointment-detail"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {(() => {
                const appointment = userAppointments.find(a => a.id === selectedAppointment);
                if (!appointment) return null;

                const status = statusConfig[appointment.status];
                const StatusIcon = status.icon;

                return (
                  <>
                    <button
                      onClick={() => { setPortalView('dashboard'); setSelectedAppointment(null); }}
                      className="flex items-center gap-2 text-muted-foreground hover:text-ivory mb-6 transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Volver a mis citas
                    </button>

                    <GlassCard className="p-8 rounded-2xl">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                        <div>
                          <h1 className="text-3xl font-bold text-ivory mb-2">Detalle de la Cita</h1>
                          <p className="text-muted-foreground">Revisa el estado y los detalles de tu solicitud.</p>
                        </div>
                        <span className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border bg-obsidian/50', status.color)}>
                          <StatusIcon className="w-5 h-5" />
                          {status.label}
                        </span>
                      </div>

                      <div className="space-y-8">
                        {/* Status Message */}
                        <div className="p-5 rounded-xl bg-emerald/10 border border-emerald/20 flex gap-4 items-start">
                          <div className="mt-0.5">
                            <StatusIcon className={cn('w-5 h-5', status.color.split(' ')[0])} />
                          </div>
                          <div>
                            <p className="font-semibold text-ivory mb-1">Estado actual: {status.label}</p>
                            <p className="text-muted-foreground text-sm">{status.description}</p>
                          </div>
                        </div>

                        {/* Service & Duration */}
                        <div className="grid sm:grid-cols-2 gap-6 p-6 rounded-xl bg-muted/5 border border-border/50">
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                              <Calendar className="w-4 h-4" />
                              Servicio
                            </p>
                            <p className="text-ivory font-semibold text-lg">{serviceLabels[appointment.serviceType]}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                              <Clock className="w-4 h-4" />
                              Duración
                            </p>
                            <p className="text-ivory font-semibold text-lg">{durations.find(d => d.value === appointment.duration)?.label}</p>
                          </div>
                        </div>

                        {/* Time Slots */}
                        <div>
                          <h3 className="text-lg font-bold text-ivory mb-4">Franja propuesta</h3>
                          <div className="grid gap-3">
                            {appointment.preferredSlots.map((slot, index) => (
                              <div key={index} className="flex items-center gap-4 p-4 rounded-xl bg-obsidian border border-border">
                                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-medium text-sm">
                                  {index + 1}
                                </div>
                                <p className="text-ivory font-medium">
                                  {new Date(slot.date).toLocaleDateString('es-ES', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                  })} a las {slot.time}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {appointment.status === 'approved' && (appointment.approvedSlot || appointment.assignedTrainer || appointment.sessionType) && (
                          <div className="p-5 rounded-xl bg-emerald/10 border border-emerald/20">
                            <h3 className="text-lg font-bold text-emerald-light mb-3 flex items-center gap-2">
                              <CheckCircle className="w-5 h-5" />
                              Cita confirmada
                            </h3>
                            <div className="space-y-2">
                              {appointment.approvedSlot && (
                                <p className="text-ivory font-medium">
                                  {new Date(appointment.approvedSlot.date).toLocaleDateString('es-ES', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                  })} a las {appointment.approvedSlot.time}
                                </p>
                              )}
                              {appointment.assignedTrainer && (
                                <p className="text-muted-foreground text-sm">
                                  Entrenador/a: <span className="text-ivory font-medium">{appointment.assignedTrainer}</span>
                                </p>
                              )}
                              {appointment.sessionType && (
                                <p className="text-muted-foreground text-sm">
                                  Tipo de sesión: <span className="text-ivory font-medium capitalize">{appointment.sessionType}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {appointment.reason && (
                          <div>
                            <h3 className="text-lg font-bold text-ivory mb-3">Tu comentario</h3>
                            <div className="p-5 rounded-xl bg-obsidian border border-border">
                              <p className="text-muted-foreground leading-relaxed">{appointment.reason}</p>
                            </div>
                          </div>
                        )}

                        <div className="pt-6 border-t border-border flex justify-between items-center">
                          <p className="text-xs text-muted-foreground">
                            ID: {appointment.id?.slice(0, 8)}...
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Solicitada el {new Date(appointment.createdAt).toLocaleDateString('es-ES', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                    </GlassCard>
                  </>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ============================================
          RESERVA DRAWER
          ============================================ */}
      <AnimatePresence>
        {showReservaDrawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowReservaDrawer(false)}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-background border-l border-border overflow-y-auto"
            >
              <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                <h2 className="text-xl font-bold text-ivory">Reservar Sesión</h2>
                <button
                  onClick={() => setShowReservaDrawer(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted/30 transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {submitSuccess ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-emerald/20 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-emerald" />
                    </div>
                    <h2 className="text-xl font-bold text-ivory mb-2">¡Solicitud Enviada!</h2>
                    <p className="text-muted-foreground">Te contactaremos pronto para confirmar tu cita.</p>
                  </div>
                ) : (
                  <>
                    {/* Servicio y duración */}
                    <GlassCard className="p-5">
                      <h3 className="text-sm font-semibold text-ivory mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald/20 text-accent text-xs flex items-center justify-center">1</span>
                        Servicio y Duración
                      </h3>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 p-3 rounded-xl bg-emerald/10 border border-accent/30">
                          <p className="text-xs text-muted-foreground mb-0.5">Servicio</p>
                          <p className="text-ivory font-semibold text-sm">{bonoServiceLabel}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-emerald/10 border border-accent/30">
                          <p className="text-xs text-muted-foreground mb-0.5">Duración</p>
                          <p className="text-ivory font-semibold text-sm">{bonoDurationValue} min</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">Determinado por tu bono activo.</p>
                    </GlassCard>

                    {/* Calendario */}
                    <GlassCard className="p-5">
                      <h3 className="text-sm font-semibold text-ivory mb-1 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald/20 text-accent text-xs flex items-center justify-center">2</span>
                        Franja Horaria
                      </h3>
                      <p className="text-xs text-muted-foreground mb-4 ml-8">Elige la franja que prefieras.</p>
                      <InteractiveCalendar
                        selectedSlot={formData.preferredSlot}
                        onSelectSlot={handleSelectSlot}
                        onClearSlot={handleClearSlot}
                      />
                    </GlassCard>

                    {/* Comentario */}
                    <GlassCard className="p-5">
                      <h3 className="text-sm font-semibold text-ivory mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-emerald/20 text-accent text-xs flex items-center justify-center">3</span>
                        Comentario (opcional)
                      </h3>
                      <textarea
                        value={formData.reason}
                        onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl bg-obsidian border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all resize-none text-sm"
                        placeholder="Cuéntanos sobre tus objetivos o cualquier lesión..."
                      />
                    </GlassCard>

                    {/* Botones */}
                    <div className="flex gap-3">
                      <PremiumButton variant="ghost" onClick={() => setShowReservaDrawer(false)} className="flex-1">
                        Cancelar
                      </PremiumButton>
                      <PremiumButton
                        variant="cta"
                        onClick={handleSubmitAppointment}
                        disabled={!formData.preferredSlot}
                        icon={<CheckCircle className="w-4 h-4" />}
                        className="flex-1"
                      >
                        Enviar Solicitud
                      </PremiumButton>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ============================================
          PERFIL MODAL
          ============================================ */}
      <AnimatePresence>
        {showProfileModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowProfileModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-background border-l border-border overflow-y-auto"
            >
              <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                <h2 className="text-xl font-bold text-ivory">Mi Perfil</h2>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted/30 transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Avatar */}
                <div className="flex flex-col items-center gap-3 pb-2">
                  <div className="relative">
                    {profilePhotoPreview || userProfile?.photoURL ? (
                      <img
                        src={profilePhotoPreview || userProfile?.photoURL}
                        alt=""
                        className="w-20 h-20 rounded-full object-cover ring-2 ring-accent/40"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald to-accent flex items-center justify-center text-obsidian font-bold text-3xl">
                        {userProfile?.name?.charAt(0)}
                      </div>
                    )}
                    <label className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-accent flex items-center justify-center cursor-pointer hover:bg-accent/80 transition-colors">
                      <Camera className="w-3.5 h-3.5 text-obsidian" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setProfilePhotoFile(file);
                            setProfilePhotoPreview(URL.createObjectURL(file));
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* Nombre */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Nombre visible</label>
                  <input
                    type="text"
                    value={profileEditForm.name}
                    onChange={e => setProfileEditForm({ ...profileEditForm, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-obsidian border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-all text-sm"
                  />
                </div>

                {/* Teléfono */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Teléfono</label>
                  <input
                    type="tel"
                    value={profileEditForm.phone}
                    onChange={e => setProfileEditForm({ ...profileEditForm, phone: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-obsidian border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-all text-sm"
                  />
                </div>

                {/* Contraseña — solo email/password */}
                {user?.providerData.some(p => p.providerId === 'password') && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Nueva contraseña</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Dejar vacío para no cambiar"
                      className="w-full px-4 py-3 rounded-xl bg-obsidian border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-all text-sm"
                    />
                  </div>
                )}

                {profileError && <p className="text-red-400 text-sm">{profileError}</p>}
                {profileSuccess && <p className="text-emerald text-sm">{profileSuccess}</p>}

                <PremiumButton
                  variant="cta"
                  onClick={handleSaveProfile}
                  loading={profileSaving}
                  className="w-full"
                >
                  Guardar cambios
                </PremiumButton>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
