'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, User, LogOut, Settings } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { PremiumButton } from '@/components/ui/premium-button';
import { useAuth } from '@/contexts/AuthContext';

const navLinks = [
  { href: '/', label: 'Inicio' },
  { href: '/sandra', label: 'Sandra' },
  { href: '/servicios', label: 'Servicios' },
  { href: '/centro', label: 'El Centro' },
  { href: '/galeria', label: 'Galería' },
  { href: '/contacto', label: 'Contacto' },
];

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const { user, userProfile, logout, isAdmin } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // No mostrar navbar en páginas de portal o admin (tienen sus propias cabeceras)
  const hideNavbar = pathname?.startsWith('/portal') || pathname?.startsWith('/admin');

  if (hideNavbar) return null;

  return (
    <motion.header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'glass-dark py-3 shadow-lg'
          : 'bg-transparent py-5'
      )}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="container mx-auto px-4">
        <nav className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <motion.div
              className="w-10 h-10 rounded-xl overflow-hidden"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Image
                src="/imagenes/logo.jpeg"
                alt="Focus Club Vallecas"
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            </motion.div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-ivory group-hover:text-accent transition-colors">
                Focus Club
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Vallecas
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'relative text-sm font-medium transition-colors hover:text-accent',
                  pathname === link.href ? 'text-accent' : 'text-ivory/80'
                )}
              >
                {link.label}
                {pathname === link.href && (
                  <motion.div
                    className="absolute -bottom-1 left-0 right-0 h-0.5 bg-accent rounded-full"
                    layoutId="navbar-indicator"
                    transition={{ duration: 0.3 }}
                  />
                )}
              </Link>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-3">
            {/* Show user menu if authenticated */}
            {user && userProfile ? (
              <>
                <Link href={isAdmin ? '/admin' : '/portal'}>
                  <PremiumButton variant="outline" size="sm" icon={<User className="w-4 h-4" />}>
                    {isAdmin ? 'Panel Admin' : 'Mi Cuenta'}
                  </PremiumButton>
                </Link>
                <button
                  onClick={() => logout()}
                  className="p-2 text-muted-foreground hover:text-ivory transition-colors"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </>
            ) : (
              <>
                <Link href="/portal">
                  <PremiumButton variant="ghost" size="sm" icon={<User className="w-4 h-4" />}>
                    Portal
                  </PremiumButton>
                </Link>
                <Link href="/admin">
                  <PremiumButton variant="ghost" size="sm" icon={<Settings className="w-4 h-4" />}>
                    Admin
                  </PremiumButton>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-ivory hover:text-accent transition-colors"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </nav>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="md:hidden glass-dark absolute top-full left-0 right-0 border-t border-border"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="container mx-auto px-4 py-6">
              <div className="flex flex-col gap-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'text-base font-medium py-2 transition-colors hover:text-accent',
                      pathname === link.href ? 'text-accent' : 'text-ivory/80'
                    )}
                    onClick={() => setIsOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
                <hr className="border-border my-2" />

                {/* User section in mobile */}
                {user && userProfile ? (
                  <>
                    <Link href={isAdmin ? '/admin' : '/portal'} onClick={() => setIsOpen(false)}>
                      <PremiumButton variant="outline" size="sm" className="w-full" icon={<User className="w-4 h-4" />}>
                        {isAdmin ? 'Panel Admin' : `Mi Cuenta (${userProfile.name.split(' ')[0]})`}
                      </PremiumButton>
                    </Link>
                    <PremiumButton
                      variant="ghost"
                      size="sm"
                      className="w-full text-destructive"
                      icon={<LogOut className="w-4 h-4" />}
                      onClick={() => {
                        logout();
                        setIsOpen(false);
                      }}
                    >
                      Cerrar Sesión
                    </PremiumButton>
                  </>
                ) : (
                  <>
                    <Link href="/portal" onClick={() => setIsOpen(false)}>
                      <PremiumButton variant="ghost" size="sm" className="w-full" icon={<User className="w-4 h-4" />}>
                        Portal Cliente
                      </PremiumButton>
                    </Link>
                    <Link href="/admin" onClick={() => setIsOpen(false)}>
                      <PremiumButton variant="ghost" size="sm" className="w-full" icon={<Settings className="w-4 h-4" />}>
                        Admin
                      </PremiumButton>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
