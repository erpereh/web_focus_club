'use client';

import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { useCMS } from '@/hooks/useFirestore';

export function FloatingWhatsApp() {
  const { cmsContent } = useCMS();

  const whatsappUrl = `https://wa.me/${cmsContent.whatsapp.replace(/\D/g, '')}`;

  return (
    <motion.a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-r from-green-600 to-green-500 flex items-center justify-center shadow-lg hover:shadow-green-500/30 transition-shadow"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 1, duration: 0.3 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      aria-label="Contactar por WhatsApp"
    >
      <MessageCircle className="w-6 h-6 text-white" />

      {/* Pulse animation */}
      <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-20" />
    </motion.a>
  );
}
