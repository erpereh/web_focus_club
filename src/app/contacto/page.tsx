'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Phone, Mail, Clock, Send, MessageCircle, CheckCircle } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { useCMS } from '@/hooks/useFirestore';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function ContactoPage() {
  const { cmsContent } = useCMS();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate form submission
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setFormData({ name: '', email: '', phone: '', subject: '', message: '' });
    }, 3000);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent" />
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-accent text-sm font-medium uppercase tracking-wider">
              Contacto
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-ivory mt-3 mb-6">
              ¿Hablamos?
            </h1>
            <p className="text-muted-foreground text-lg">
              Estamos aquí para responder tus preguntas y ayudarte a comenzar tu transformación.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Contact Info */}
            <motion.div
              className="lg:col-span-1 space-y-6"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {[
                {
                  icon: MapPin,
                  title: 'Dirección',
                  content: cmsContent.address,
                  action: null,
                },
                {
                  icon: Phone,
                  title: 'Teléfono',
                  content: cmsContent.phone,
                  action: `tel:${cmsContent.phone}`,
                },
                {
                  icon: Mail,
                  title: 'Email',
                  content: cmsContent.email,
                  action: `mailto:${cmsContent.email}`,
                },
                {
                  icon: Clock,
                  title: 'Horario',
                  content: 'L-V: 7:00-21:00 | S: 9:00-14:00',
                  action: null,
                },
              ].map((item, index) => (
                <motion.div key={index} variants={itemVariants}>
                  <GlassCard className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <item.icon className="w-6 h-6 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-ivory mb-1">{item.title}</h3>
                      {item.action ? (
                        <a
                          href={item.action}
                          className="text-muted-foreground hover:text-accent transition-colors text-sm"
                        >
                          {item.content}
                        </a>
                      ) : (
                        <p className="text-muted-foreground text-sm">{item.content}</p>
                      )}
                    </div>
                  </GlassCard>
                </motion.div>
              ))}

              {/* WhatsApp Card */}
              <motion.div variants={itemVariants}>
                <GlassCard className="bg-gradient-to-r from-green-900/30 to-green-800/20 border-green-500/20">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                      <MessageCircle className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-ivory mb-1">WhatsApp</h3>
                      <a
                        href={`https://wa.me/${cmsContent.whatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-400 hover:text-green-300 transition-colors text-sm"
                      >
                        Enviar mensaje directo
                      </a>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            </motion.div>

            {/* Contact Form */}
            <motion.div
              className="lg:col-span-2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <GlassCard className="p-8">
                {submitted ? (
                  <motion.div
                    className="text-center py-12"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold text-ivory mb-2">
                      ¡Mensaje enviado!
                    </h3>
                    <p className="text-muted-foreground">
                      Te responderemos lo antes posible.
                    </p>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-ivory mb-2">
                          Nombre completo
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={formData.name}
                          onChange={handleChange}
                          required
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light transition-colors"
                          placeholder="Tu nombre"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ivory mb-2">
                          Email
                        </label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleChange}
                          required
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light transition-colors"
                          placeholder="tu@email.com"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-ivory mb-2">
                          Teléfono
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleChange}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light transition-colors"
                          placeholder="+34 600 000 000"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ivory mb-2">
                          Asunto
                        </label>
                        <select
                          name="subject"
                          value={formData.subject}
                          onChange={handleChange}
                          required
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory focus:outline-none focus:border-emerald-light transition-colors"
                        >
                          <option value="">Selecciona un asunto</option>
                          <option value="info">Información general</option>
                          <option value="training">Entrenamiento personal</option>
                          <option value="physio">Fisioterapia</option>
                          <option value="pilates">Pilates</option>
                          <option value="nutrition">Nutrición</option>
                          <option value="other">Otro</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-ivory mb-2">
                        Mensaje
                      </label>
                      <textarea
                        name="message"
                        value={formData.message}
                        onChange={handleChange}
                        required
                        rows={5}
                        className="w-full px-4 py-3 rounded-xl bg-input border border-border text-ivory placeholder:text-muted-foreground focus:outline-none focus:border-emerald-light transition-colors resize-none"
                        placeholder="¿En qué podemos ayudarte?"
                      />
                    </div>

                    <PremiumButton
                      type="submit"
                      variant="cta"
                      size="lg"
                      icon={<Send className="w-4 h-4" />}
                      iconPosition="right"
                      className="w-full sm:w-auto"
                    >
                      Enviar Mensaje
                    </PremiumButton>
                  </form>
                )}
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <motion.div
            className="rounded-3xl overflow-hidden glass-card p-2"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="aspect-video md:aspect-[21/9] rounded-2xl bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center">
              <div className="text-center p-8">
                <MapPin className="w-12 h-12 text-accent mx-auto mb-4" />
                <p className="text-ivory font-semibold text-lg">Focus Club Vallecas</p>
                <p className="text-muted-foreground text-sm mt-2">
                  {cmsContent.address}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
