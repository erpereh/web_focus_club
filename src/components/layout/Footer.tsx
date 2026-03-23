'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dumbbell, Mail, Phone, MapPin, Instagram, Facebook, Twitter } from 'lucide-react';
import { useCMS } from '@/hooks/useFirestore';

const footerLinks = [
  { href: '/', label: 'Inicio' },
  { href: '/sandra', label: 'Sobre Sandra' },
  { href: '/servicios', label: 'Servicios' },
  { href: '/centro', label: 'El Centro' },
  { href: '/galeria', label: 'Galería' },
  { href: '/contacto', label: 'Contacto' },
  { href: '/solicitar-cita', label: 'Reservar Cita' },
];

export function Footer() {
  const pathname = usePathname();
  const { cmsContent } = useCMS();

  // No mostrar footer en páginas de portal o admin
  const hideFooter = pathname?.startsWith('/portal') || pathname?.startsWith('/admin');
  if (hideFooter) return null;

  return (
    <footer className="relative bg-carbon border-t border-border mt-auto">
      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />

      <div className="container mx-auto px-4 py-12 relative">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-2">
              <motion.div
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-forest-500 flex items-center justify-center"
                whileHover={{ scale: 1.05 }}
              >
                <Dumbbell className="w-5 h-5 text-ivory" />
              </motion.div>
              <div className="flex flex-col">
                <span className="text-lg font-bold tracking-tight text-ivory">
                  Focus Club
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Vallecas
                </span>
              </div>
            </Link>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {cmsContent.footerText}
            </p>
            <div className="flex items-center gap-3">
              {[Instagram, Facebook, Twitter].map((Icon, i) => (
                <motion.a
                  key={i}
                  href="#"
                  className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-accent hover:bg-muted/80 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Icon className="w-4 h-4" />
                </motion.a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-sm font-semibold text-ivory uppercase tracking-wider mb-4">
              Enlaces Rápidos
            </h3>
            <ul className="space-y-3">
              {footerLinks.slice(0, 4).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-accent transition-colors text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="text-sm font-semibold text-ivory uppercase tracking-wider mb-4">
              Servicios
            </h3>
            <ul className="space-y-3">
              <li>
                <Link href="/servicios" className="text-muted-foreground hover:text-accent transition-colors text-sm">
                  Entrenamiento Personal
                </Link>
              </li>
              <li>
                <Link href="/servicios" className="text-muted-foreground hover:text-accent transition-colors text-sm">
                  Fisioterapia Deportiva
                </Link>
              </li>
              <li>
                <Link href="/servicios" className="text-muted-foreground hover:text-accent transition-colors text-sm">
                  Pilates Premium
                </Link>
              </li>
              <li>
                <Link href="/servicios" className="text-muted-foreground hover:text-accent transition-colors text-sm">
                  Consulta Nutricional
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold text-ivory uppercase tracking-wider mb-4">
              Contacto
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                <span className="text-muted-foreground text-sm">{cmsContent.address}</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-accent flex-shrink-0" />
                <a
                  href={`tel:${cmsContent.phone}`}
                  className="text-muted-foreground hover:text-accent transition-colors text-sm"
                >
                  {cmsContent.phone}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-accent flex-shrink-0" />
                <a
                  href={`mailto:${cmsContent.email}`}
                  className="text-muted-foreground hover:text-accent transition-colors text-sm"
                >
                  {cmsContent.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-border mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} Focus Club Vallecas. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/politica-de-privacidad" className="text-muted-foreground hover:text-accent text-sm transition-colors">
              Política de Privacidad
            </Link>
            <Link href="/cookies" className="text-muted-foreground hover:text-accent text-sm transition-colors">
              Política de Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
