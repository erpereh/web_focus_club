'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Send } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useCMS } from '@/hooks/useFirestore';
import { sendContactMessage } from '@/lib/firestore';

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emptyFormData = {
  name: '',
  email: '',
  phone: '',
  subject: '',
  message: '',
  company: '',
};

export default function ContactoPage() {
  const { cmsContent } = useCMS();
  const contacto = cmsContent.contacto!;
  const [formData, setFormData] = useState(emptyFormData);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const validateForm = () => {
    if (!formData.name.trim()) return 'El nombre es obligatorio.';
    if (!emailRegex.test(formData.email.trim())) return 'Introduce un email valido.';
    if (!formData.subject.trim()) return 'Selecciona un asunto.';
    if (!formData.message.trim()) return 'El mensaje es obligatorio.';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const validationError = validateForm();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await sendContactMessage({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        subject: formData.subject,
        message: formData.message,
        company: formData.company,
      });
      setSubmitted(true);
      setFormData(emptyFormData);
      setTimeout(() => setSubmitted(false), 5000);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se ha podido enviar el mensaje. Intentalo de nuevo mas tarde.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const visibleCards = (contacto.cards ?? []).filter((card) => card.active !== false);

  return (
    <div className="min-h-screen">
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-accent-dim)] to-transparent" />
        <div className="container mx-auto px-4">
          <motion.div
            className="text-center max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="eyebrow">{contacto.heroEyebrow}</span>
            <h1 className="text-4xl md:text-5xl font-bold text-[var(--color-text-primary)] mt-3 mb-6">
              {contacto.heroTitle}
            </h1>
            <p className="text-[var(--color-text-secondary)] text-lg">
              {contacto.heroSubtitle}
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-3 gap-8">
            <motion.div
              className="lg:col-span-1 space-y-6"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {visibleCards.map((card, index) => (
                <motion.div key={`${card.title}-${index}`} variants={itemVariants}>
                  <GlassCard className={card.title.toLowerCase().includes('whatsapp') ? 'bg-gradient-to-r from-green-900/30 to-green-800/20 border-green-500/20' : 'flex items-start gap-4'}>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${card.title.toLowerCase().includes('whatsapp') ? 'bg-green-500/20' : 'bg-[var(--color-accent-dim)]'}`}>
                      <DynamicIcon
                        name={card.icon}
                        className={`w-6 h-6 ${card.title.toLowerCase().includes('whatsapp') ? 'text-green-400' : 'text-[var(--color-accent-val)]'}`}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">{card.title}</h3>
                      <p className="text-[var(--color-text-secondary)] text-sm">{card.content}</p>
                      {card.linkUrl && (
                        <a
                          href={card.linkUrl}
                          target={card.linkUrl.startsWith('http') ? '_blank' : undefined}
                          rel={card.linkUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                          className={`inline-block mt-2 text-sm transition-colors ${card.title.toLowerCase().includes('whatsapp') ? 'text-green-400 hover:text-green-300' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)]'}`}
                        >
                          {card.linkText || card.linkUrl}
                        </a>
                      )}
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </motion.div>

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
                    <div className="w-16 h-16 rounded-full bg-[var(--color-accent-dim)] flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-[var(--color-accent-val)]" />
                    </div>
                    <h3 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
                      {contacto.successTitle}
                    </h3>
                    <p className="text-[var(--color-text-secondary)]">
                      {contacto.successMessage}
                    </p>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {(contacto.formTitle || contacto.formSubtitle) && (
                      <div>
                        {contacto.formTitle && <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">{contacto.formTitle}</h2>}
                        {contacto.formSubtitle && <p className="text-[var(--color-text-secondary)] text-sm">{contacto.formSubtitle}</p>}
                      </div>
                    )}
                    <input
                      type="text"
                      name="company"
                      value={formData.company}
                      onChange={handleChange}
                      className="hidden"
                      tabIndex={-1}
                      autoComplete="off"
                      aria-hidden="true"
                    />
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                          {contacto.nameLabel}
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={formData.name}
                          onChange={handleChange}
                          required
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent-val)] transition-colors"
                          placeholder={contacto.namePlaceholder}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                          {contacto.emailLabel}
                        </label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleChange}
                          required
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent-val)] transition-colors"
                          placeholder={contacto.emailPlaceholder}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                          {contacto.phoneLabel}
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleChange}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent-val)] transition-colors"
                          placeholder={contacto.phonePlaceholder}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                          {contacto.subjectLabel}
                        </label>
                        <select
                          name="subject"
                          value={formData.subject}
                          onChange={handleChange}
                          required
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] transition-colors"
                        >
                          <option value="">{contacto.subjectPlaceholder}</option>
                          {(contacto.subjects ?? []).map((subject) => (
                            <option key={subject} value={subject}>
                              {subject}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                        {contacto.messageLabel}
                      </label>
                      <textarea
                        name="message"
                        value={formData.message}
                        onChange={handleChange}
                        required
                        rows={5}
                        className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent-val)] transition-colors resize-none"
                        placeholder={contacto.messagePlaceholder}
                      />
                    </div>

                    {errorMessage && (
                      <p role="alert" className="text-sm text-red-400">
                        {errorMessage}
                      </p>
                    )}

                    <PremiumButton
                      type="submit"
                      variant="cta"
                      size="lg"
                      icon={<Send className="w-4 h-4" />}
                      iconPosition="right"
                      loading={isSubmitting}
                      className="w-full sm:w-auto"
                    >
                      {isSubmitting ? 'Enviando...' : contacto.submitText}
                    </PremiumButton>
                  </form>
                )}
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="container mx-auto px-4">
          <motion.div
            className="rounded-3xl overflow-hidden card-glass p-2"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="relative aspect-video md:aspect-[21/9] rounded-2xl overflow-hidden">
              {contacto.mapUrl ? (
                <iframe
                  src={contacto.mapUrl}
                  className="absolute inset-0 w-full h-full"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Focus Club Vallecas mapa"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)] bg-black/20">
                  El mapa no está configurado todavía.
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
