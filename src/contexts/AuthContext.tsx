'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    sendEmailVerification,
    sendPasswordResetEmail,
    User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { getUserProfile, createUserProfile, updateUserProfile } from '@/lib/firestore';
import type { UserProfile } from '@/types';

// ============================================
// TIPOS
// ============================================

interface LoginResult {
    success: boolean;
    message: string;
    needsVerification?: boolean;
}

interface GoogleLoginResult {
    success: boolean;
    message: string;
    needsProfile?: boolean; // true si es primera vez con Google y falta teléfono
}

interface AuthContextType {
    user: FirebaseUser | null;
    userProfile: UserProfile | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<LoginResult>;
    register: (email: string, password: string, name: string, phone: string) => Promise<LoginResult>;
    loginWithGoogle: () => Promise<GoogleLoginResult>;
    logout: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ success: boolean; message: string }>;
    resendVerification: () => Promise<{ success: boolean; message: string }>;
    completeGoogleProfile: (name: string, phone: string) => Promise<{ success: boolean; message: string }>;
    refreshUserProfile: () => Promise<void>;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ============================================
// PROVIDER
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Listener de autenticación
    useEffect(() => {
        // Timeout de seguridad: si tras 5s sigue loading, forzar false
        const timeout = setTimeout(() => {
            setLoading(false);
        }, 5000);

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            clearTimeout(timeout);
            setUser(firebaseUser);

            if (firebaseUser) {
                try {
                    const profile = await getUserProfile(firebaseUser.uid);
                    setUserProfile(profile);
                } catch {
                    setUserProfile(null);
                }
            } else {
                setUserProfile(null);
            }

            setLoading(false);
        });

        return () => {
            clearTimeout(timeout);
            unsubscribe();
        };
    }, []);

    // ============================================
    // LOGIN CON EMAIL + PASSWORD
    // ============================================

    const login = async (email: string, password: string): Promise<LoginResult> => {
        try {
            const cred = await signInWithEmailAndPassword(auth, email, password);

            // Bloquear si no ha verificado el email
            if (!cred.user.emailVerified) {
                // No hacer signOut — el usuario se queda "semi-logueado" para poder reenviar verificación
                return {
                    success: false,
                    message: 'Debes verificar tu email antes de acceder. Revisa tu bandeja de entrada.',
                    needsVerification: true,
                };
            }

            const profile = await getUserProfile(cred.user.uid);
            setUserProfile(profile);
            return { success: true, message: 'Login exitoso' };
        } catch (error: unknown) {
            const code = (error as { code?: string })?.code;
            const messages: Record<string, string> = {
                'auth/user-not-found': 'No existe una cuenta con este email',
                'auth/wrong-password': 'Contraseña incorrecta',
                'auth/invalid-email': 'Email no válido',
                'auth/invalid-credential': 'Email o contraseña incorrectos',
                'auth/too-many-requests': 'Demasiados intentos. Espera un momento',
            };
            return { success: false, message: messages[code ?? ''] || 'Error al iniciar sesión' };
        }
    };

    // ============================================
    // REGISTRO CON EMAIL + PASSWORD + VERIFICACIÓN
    // ============================================

    const register = async (email: string, password: string, name: string, phone: string): Promise<LoginResult> => {
        try {
            // 1. Crear cuenta en Firebase Auth
            const cred = await createUserWithEmailAndPassword(auth, email, password);

            // 2. Enviar email de verificación
            await sendEmailVerification(cred.user);

            // 3. Crear perfil en Firestore con role: "user" por defecto
            const profile: UserProfile = {
                uid: cred.user.uid,
                email,
                name,
                phone,
                role: 'user',
                isTrainer: false,
                createdAt: new Date().toISOString(),
            };
            await createUserProfile(profile);

            // 4. Cerrar sesión para que no entre sin verificar
            await signOut(auth);
            setUser(null);
            setUserProfile(null);

            return {
                success: true,
                message: 'Cuenta creada. Revisa tu bandeja de entrada para verificar tu email.',
            };
        } catch (error: unknown) {
            const code = (error as { code?: string })?.code;
            const messages: Record<string, string> = {
                'auth/email-already-in-use': 'Este email ya está registrado',
                'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
                'auth/invalid-email': 'Email no válido',
            };
            return { success: false, message: messages[code ?? ''] || 'Error al registrarse' };
        }
    };

    // ============================================
    // LOGIN CON GOOGLE
    // ============================================

    const loginWithGoogle = async (): Promise<GoogleLoginResult> => {
        try {
            const cred = await signInWithPopup(auth, googleProvider);
            const firebaseUser = cred.user;

            // Comprobar si ya existe perfil en Firestore
            let profile = await getUserProfile(firebaseUser.uid);

            if (!profile) {
                // Primera vez con Google: crear perfil parcial (sin teléfono)
                profile = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || '',
                    name: firebaseUser.displayName || '',
                    role: 'user',
                    isTrainer: false,
                    createdAt: new Date().toISOString(),
                };
                await createUserProfile(profile);
                setUserProfile(profile);

                return {
                    success: true,
                    message: 'Cuenta creada con Google',
                    needsProfile: true, // Necesita completar perfil (teléfono)
                };
            }

            // Ya existe perfil — comprobar si le falta el teléfono
            setUserProfile(profile);

            if (!profile.phone) {
                return {
                    success: true,
                    message: 'Login con Google exitoso',
                    needsProfile: true,
                };
            }

            return { success: true, message: 'Login con Google exitoso' };
        } catch (error: unknown) {
            const code = (error as { code?: string })?.code;
            if (code === 'auth/popup-closed-by-user') {
                return { success: false, message: 'Inicio de sesión cancelado' };
            }
            if (code === 'auth/account-exists-with-different-credential') {
                return {
                    success: false,
                    message: 'Ya existe una cuenta con este email. Inicia sesión con email y contraseña.',
                };
            }
            return { success: false, message: 'Error al iniciar sesión con Google' };
        }
    };

    // ============================================
    // COMPLETAR PERFIL (tras Google sign-in)
    // ============================================

    const completeGoogleProfile = async (name: string, phone: string) => {
        try {
            if (!user) return { success: false, message: 'No hay usuario autenticado' };

            await updateUserProfile(user.uid, { name, phone });

            // Actualizar estado local
            setUserProfile(prev => prev ? { ...prev, name, phone } : null);

            return { success: true, message: 'Perfil actualizado correctamente' };
        } catch {
            return { success: false, message: 'Error al actualizar el perfil' };
        }
    };

    // ============================================
    // REENVIAR VERIFICACIÓN
    // ============================================

    const resendVerification = async () => {
        try {
            // Intentar obtener el usuario actual de Firebase Auth
            const currentUser = auth.currentUser;
            if (!currentUser) {
                return { success: false, message: 'No hay sesión activa. Intenta iniciar sesión de nuevo.' };
            }
            await sendEmailVerification(currentUser);
            return { success: true, message: 'Email de verificación reenviado. Revisa tu bandeja de entrada.' };
        } catch (error: unknown) {
            const code = (error as { code?: string })?.code;
            if (code === 'auth/too-many-requests') {
                return { success: false, message: 'Demasiados intentos. Espera unos minutos.' };
            }
            return { success: false, message: 'Error al reenviar el email de verificación.' };
        }
    };

    // ============================================
    // RECUPERAR CONTRASEÑA
    // ============================================

    const resetPassword = async (email: string) => {
        try {
            await sendPasswordResetEmail(auth, email);
            return {
                success: true,
                message: 'Email de recuperación enviado. Revisa tu bandeja de entrada.',
            };
        } catch (error: unknown) {
            const code = (error as { code?: string })?.code;
            const messages: Record<string, string> = {
                'auth/user-not-found': 'No existe una cuenta con este email',
                'auth/invalid-email': 'Email no válido',
                'auth/too-many-requests': 'Demasiados intentos. Espera un momento',
            };
            return { success: false, message: messages[code ?? ''] || 'Error al enviar el email' };
        }
    };

    // ============================================
    // LOGOUT
    // ============================================

    const logout = async () => {
        await signOut(auth);
        setUser(null);
        setUserProfile(null);
    };

    // ============================================
    // REFRESCAR PERFIL (tras cambios de rol/isTrainer)
    // ============================================

    const refreshUserProfile = async () => {
        if (!user) return;
        try {
            const profile = await getUserProfile(user.uid);
            setUserProfile(profile);
        } catch {
            // silenciar errores
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                userProfile,
                loading,
                login,
                register,
                loginWithGoogle,
                logout,
                resetPassword,
                resendVerification,
                completeGoogleProfile,
                refreshUserProfile,
                isAdmin: userProfile?.role === 'admin',
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth debe usarse dentro de un AuthProvider');
    }
    return context;
}
