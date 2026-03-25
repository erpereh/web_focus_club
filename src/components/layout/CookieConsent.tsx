'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Shield, X } from 'lucide-react';

export function CookieConsent() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Only show if not previously accepted
        const accepted = localStorage.getItem('cookies_accepted');
        if (!accepted) {
            // Small delay so it doesn't flash on load
            const timer = setTimeout(() => setVisible(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem('cookies_accepted', 'true');
        setVisible(false);
    };

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    className="fixed bottom-0 left-0 right-0 z-50 p-4"
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                >
                    <div className="max-w-4xl mx-auto bg-[var(--color-bg-base)]/95 backdrop-blur-xl border border-[var(--color-border-base)] rounded-2xl p-6 shadow-2xl">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                            {/* Icon + Text */}
                            <div className="flex items-start gap-3 flex-1">
                                <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Shield className="w-5 h-5 text-[var(--color-accent-val)]" />
                                </div>
                                <div>
                                    <p className="text-[var(--color-text-primary)] text-sm font-medium mb-1">
                                        Aviso de Cookies
                                    </p>
                                    <p className="text-[var(--color-text-secondary)] text-xs leading-relaxed">
                                        Utilizamos cookies propias y de terceros para mejorar tu experiencia de navegación y analizar
                                        el uso del sitio web. Al aceptar, consientes el uso de estas cookies.{' '}
                                        <Link
                                            href="/cookies"
                                            className="text-[var(--color-accent-val)] hover:underline"
                                        >
                                            Política de Cookies
                                        </Link>
                                    </p>
                                </div>
                            </div>

                            {/* Buttons */}
                            <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                                <button
                                    onClick={handleAccept}
                                    className="flex-1 sm:flex-none btn-primary px-6 py-2.5 rounded-lg text-sm"
                                >
                                    Aceptar
                                </button>
                                <button
                                    onClick={() => setVisible(false)}
                                    className="p-2.5 rounded-xl text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-dim)] transition-colors duration-300"
                                    aria-label="Cerrar aviso"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
