'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, Phone, MapPin, Instagram } from 'lucide-react';
import { useCMS } from '@/hooks/useFirestore';

const footerLinks = [
  { href: '/', label: 'Inicio' },
  { href: '/sandra', label: 'Sobre Sandra' },
  { href: '/servicios', label: 'Servicios' },
  { href: '/centro', label: 'El Centro' },
  { href: '/galeria', label: 'Galería' },
  { href: '/contacto', label: 'Contacto' },
  { href: '/portal', label: 'Reservar Cita' },
];

export function Footer() {
  const pathname = usePathname();
  const { cmsContent } = useCMS();

  // No mostrar footer en páginas de portal o admin
  const hideFooter = pathname?.startsWith('/portal') || pathname?.startsWith('/admin');
  if (hideFooter) return null;

  return (
    <footer className="relative bg-[#050505] mt-auto">
      {/* Gradient top line */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-accent-val)] to-transparent" />

      <div className="container mx-auto px-4 py-12 relative">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link href="/" className="flex flex-col group">
              <motion.span
                className="text-lg font-bold tracking-tight text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-val)] transition-colors duration-300"
                whileHover={{ scale: 1.02 }}
              >
                Focus Club
              </motion.span>
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-accent-val)]">
                Vallecas
              </span>
            </Link>
            <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
              {cmsContent.footerText}
            </p>
            <div className="flex items-center gap-3">
              <motion.a
                href={cmsContent.socialInstagram}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-[var(--color-bg-card)] flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] hover:bg-[var(--color-bg-card-hover)] transition-all duration-300"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Instagram className="w-4 h-4" />
              </motion.a>
              <motion.a
                href={`https://wa.me/${cmsContent.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-[var(--color-bg-card)] flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] hover:bg-[var(--color-bg-card-hover)] transition-all duration-300"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </motion.a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] uppercase tracking-wider mb-4">
              Enlaces Rápidos
            </h3>
            <ul className="space-y-3">
              {footerLinks.slice(0, 4).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] uppercase tracking-wider mb-4">
              Servicios
            </h3>
            <ul className="space-y-3">
              <li>
                <Link href="/servicios" className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm">
                  Entrenamiento Personal
                </Link>
              </li>
              <li>
                <Link href="/servicios" className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm">
                  Fisioterapia Deportiva
                </Link>
              </li>
              <li>
                <Link href="/servicios" className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm">
                  Pilates Premium
                </Link>
              </li>
              <li>
                <Link href="/servicios" className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm">
                  Consulta Nutricional
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] uppercase tracking-wider mb-4">
              Contacto
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-[var(--color-accent-val)] mt-0.5 flex-shrink-0" />
                <a
                  href="https://maps.app.goo.gl/EHFk2xEh9xwHBaDKA"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm"
                >
                  {cmsContent.address}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-[var(--color-accent-val)] flex-shrink-0" />
                <a
                  href={`tel:${cmsContent.phone}`}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm"
                >
                  {cmsContent.phone}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-[var(--color-accent-val)] flex-shrink-0" />
                <a
                  href={`mailto:${cmsContent.email}`}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors duration-300 text-sm"
                >
                  {cmsContent.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-[var(--color-border-base)] mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[var(--color-text-muted)] text-sm">
            © {new Date().getFullYear()} Focus Club Vallecas. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/politica-de-privacidad" className="text-[var(--color-text-muted)] hover:text-[var(--color-accent-val)] text-sm transition-colors duration-300">
              Política de Privacidad
            </Link>
            <Link href="/cookies" className="text-[var(--color-text-muted)] hover:text-[var(--color-accent-val)] text-sm transition-colors duration-300">
              Política de Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
