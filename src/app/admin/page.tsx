'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';

import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  User,
  Mail,
  Phone,
  CalendarClock,
  Check,
  RefreshCw,
  Trash2,
  Edit3,
  Save,
  ArrowLeft,
  BarChart3,
  Users,
  TrendingUp,
  AlertCircle,
  Plus,
  Star,
  Image as ImageIcon,
  Images,
  Award,
  Trophy,
  MapPin,
  Globe,
  Lock,
  CalendarOff,
  Dumbbell,
  FileText,
  Search,
  Menu,
  X,
  MailCheck,
  KeyRound,
  Ticket,
  Minus,
  History,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Layers,
  Eye,
  EyeOff,
  Play,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { ContextualImageManager } from '@/components/ui/ContextualImageManager';
import { GalleryManager } from '@/components/admin/GalleryManager';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { IconPicker } from '@/components/admin/IconPicker';
import { VideoFramePreview } from '@/components/ui/VideoFramePreview';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/contexts/AuthContext';
import { useMediaLibrary } from '@/hooks/useMediaLibrary';
import { defaultCMS } from '@/hooks/useFirestore';
import { toast } from '@/hooks/use-toast';
import type { TimeSlot, Service, Testimonial, Appointment, CMSContent, GaleriaContent, ContactoConfig, ContactoCard, BlockedSlot, Trainer, SiteConfig, Bono, BrandingConfig, HeroStat, SandraAchievement, SandraValue, CentroConfig, GaleriaTrainingItem, GaleriaResultado, GaleriaStat } from '@/types';
import { getBonoMinutosRestantes, getBonoMinutosTotales, formatMinutos } from '@/types';
import {
  getAppointments,
  getAppointmentsByUser,
  updateAppointmentStatus as updateAppointmentStatusFS,
  deleteAppointment as deleteAppointmentFS,
  getServices,
  addService as addServiceFS,
  updateService as updateServiceFS,
  deleteService as deleteServiceFS,
  getTestimonials,
  addTestimonial as addTestimonialFS,
  updateTestimonial as updateTestimonialFS,
  deleteTestimonial as deleteTestimonialFS,
  approveTestimonial as approveTestimonialFS,
  getSiteContent,
  updateSiteContent,
  updateSandraData as updateSandraDataFS,
  updateCentroConfig as updateCentroConfigFS,
  getCentroConfig as getCentroConfigFS,
  updateGaleriaConfig as updateGaleriaConfigFS,
  getGaleriaConfig as getGaleriaConfigFS,
  getUsers,
  getUserProfile,
  addActivityLog,
  getBlockedSlots,
  addBlockedSlot as addBlockedSlotFS,
  deleteBlockedSlot as deleteBlockedSlotFS,
  incrementSlotOccupancy,
  decrementSlotOccupancy,
  getTrainers,
  getActiveTrainers,
  addTrainer as addTrainerFS,
  deleteTrainer as deleteTrainerFS,
  getTrainerByUid,
  getAppointmentsByTrainer,
  updateTrainerNotes,
  updateUserProfile,
  getSiteConfig,
  updateSiteConfig as updateSiteConfigFS,
  generateTimeSlots,
  updateAppointmentSlot as updateAppointmentSlotFS,
  getAllActiveBonos,
  getActiveBonoByUser,
  getBonosByUser,
  assignBono,
  deactivateBono,
  deleteBono,
  addBonoMinutes,
  deductBonoMinutes,
  returnBonoMinutes,
  manualDeductBonoMinutes,
  recalculateAllBonoExpirations,
  expireOverdueBonos,
  getBrandingConfig,
  updateBrandingConfig,

} from '@/lib/firestore';
import { cn } from '@/lib/utils';
import type { UserProfile } from '@/types';

const DEFAULT_HERO_STATS: HeroStat[] = [
  { icon: 'Award', value: '15+', label: 'Años de Experiencia' },
  { icon: 'Users', value: '500+', label: 'Clientes Satisfechos' },
  { icon: 'Dumbbell', value: '4', label: 'Servicios Premium' },
  { icon: 'Heart', value: '100%', label: 'Compromiso' },
];

// --- Make.com Webhook ---
const WEBHOOK_URL = 'https://hook.eu1.make.com/rnc4rpwq70l52h69qm8m21ekafbffcql';

async function sendWebhook(payload: {
  action: 'confirmed' | 'deleted';
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  sessionType: string;
  trainerName: string;
}) {
  try {
    console.log('[Webhook] Sending:', payload);
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('[Webhook] Response status:', res.status);
  } catch (err) {
    console.error('[Webhook] Failed:', err);
  }
}


type TabType = 'Inicio' | 'appointments' | 'availability' | 'clients' | 'team' | 'testimonials' | 'Hero' | 'Sandra' | 'Centro' | 'Servicios' | 'Galeria' | 'Contacto' | 'Footer' | 'config';
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const statusConfig = {
  pending: {
    label: 'Pendiente',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    icon: Clock,
  },
  approved: {
    label: 'Aprobada',
    color: 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border-[var(--color-accent-border)]',
    icon: CheckCircle,
  },
  rejected: {
    label: 'Rechazada',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
    icon: XCircle,
  },
};

const serviceLabels: Record<string, string> = {
  training: 'Entrenamiento Personal',
  competition: 'Preparación para Competición',
  nutrition: 'Nutrición y Recomposición',
  assessment: 'Valoración Inicial',
};

const durationLabels: Record<string, string> = {
  '30': '30 minutos',
  '45': '45 minutos',
  '60': '60 minutos',
  '90': '90 minutos', // legacy
};

// ─── Sortable Timeline Item (for dnd-kit) ────────────────────────────────────
function SortableTimelineItem({
  item,
  index,
  onUpdate,
  onRemove,
}: {
  item: { year: string; title: string; description: string };
  index: number;
  onUpdate: (field: 'year' | 'title' | 'description', val: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border">
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <input
          type="text"
          value={item.year}
          onChange={(e) => onUpdate('year', e.target.value)}
          placeholder="Año"
          className="w-20 px-3 py-2 rounded-lg bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
        />
        <input
          type="text"
          value={item.title}
          onChange={(e) => onUpdate('title', e.target.value)}
          placeholder="Título"
          className="flex-1 px-3 py-2 rounded-lg bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
        />
        <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg flex-shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <textarea
        value={item.description}
        onChange={(e) => onUpdate('description', e.target.value)}
        placeholder="Descripción"
        rows={2}
        className="w-full px-3 py-2 rounded-lg bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none text-sm"
      />
    </div>
  );
}

// ─── Sortable Service Item (accordion) ───────────────────────────────────────
function SortableServiceItem({
  service,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
  onUpdateFeature,
  onRemoveFeature,
  onAddFeature,
}: {
  service: import('@/types').Service;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: string, value: unknown) => void;
  onRemove: () => void;
  onUpdateFeature: (i: number, val: string) => void;
  onRemoveFeature: (i: number) => void;
  onAddFeature: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: service.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const inputCls = 'px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm w-full';

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-border bg-[var(--color-bg-card)] overflow-hidden mb-3">
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none flex-shrink-0">
          <GripVertical className="w-4 h-4" />
        </button>
        <IconPicker value={service.icon ?? 'Dumbbell'} onChange={(icon) => onUpdate('icon', icon)} />
        <input
          type="text"
          value={service.title ?? ''}
          onChange={(e) => onUpdate('title', e.target.value)}
          placeholder="Título del servicio"
          className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
        />
        {/* Active toggle */}
        <button
          type="button"
          onClick={() => onUpdate('active', service.active === false ? true : false)}
          title={service.active === false ? 'Mostrar en web' : 'Ocultar en web'}
          className={`p-2 rounded-xl flex-shrink-0 transition-colors ${service.active === false ? 'text-[var(--color-text-muted)] hover:text-[var(--color-accent-val)]' : 'text-[var(--color-accent-val)] hover:text-[var(--color-text-muted)]'}`}
        >
          {service.active === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        {/* Expand toggle */}
        <button type="button" onClick={onToggle} className="p-2 text-[var(--color-text-secondary)] hover:text-white rounded-xl flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {/* Delete */}
        <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl flex-shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          {/* Descripción */}
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Descripción</label>
            <textarea
              value={service.description ?? ''}
              onChange={(e) => onUpdate('description', e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder="Descripción del servicio..."
            />
          </div>
          {/* Duración + Precio */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Duración</label>
              <input type="text" value={service.duration ?? ''} onChange={(e) => onUpdate('duration', e.target.value)} placeholder="Ej: 1 hora" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Precio</label>
              <input type="text" value={service.price ?? ''} onChange={(e) => onUpdate('price', e.target.value)} placeholder="Ej: Desde 50€" className={inputCls} />
            </div>
          </div>
          {/* Features */}
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-2">Características (checks verdes)</label>
            <div className="space-y-2">
              {(service.features ?? []).map((f, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={f} onChange={(e) => onUpdateFeature(i, e.target.value)} className={inputCls} placeholder="Característica..." />
                  <button type="button" onClick={() => onRemoveFeature(i)} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onAddFeature}
              className="mt-2 flex items-center gap-1 text-sm text-[var(--color-accent-val)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Plus className="w-4 h-4" /> Añadir característica
            </button>
          </div>
          {/* CTA */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Texto botón CTA</label>
              <input type="text" value={service.ctaText ?? ''} onChange={(e) => onUpdate('ctaText', e.target.value)} placeholder="Reservar" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Enlace CTA</label>
              <input type="text" value={service.ctaLink ?? ''} onChange={(e) => onUpdate('ctaLink', e.target.value)} placeholder="/portal" className={inputCls} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sortable FAQ Item ────────────────────────────────────────────────────────
function SortableFaqItem({
  faq,
  index,
  onUpdate,
  onRemove,
}: {
  faq: { question: string; answer: string };
  index: number;
  onUpdate: (field: 'question' | 'answer', val: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border space-y-2 mb-2">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none flex-shrink-0">
          <GripVertical className="w-4 h-4" />
        </button>
        <input
          type="text"
          value={faq.question ?? ''}
          onChange={(e) => onUpdate('question', e.target.value)}
          placeholder="Pregunta..."
          className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
        />
        <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl flex-shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <textarea
        value={faq.answer ?? ''}
        onChange={(e) => onUpdate('answer', e.target.value)}
        rows={2}
        placeholder="Respuesta..."
        className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none text-sm"
      />
    </div>
  );
}

function SortableCentroZonaItem({
  zona,
  index,
  onUpdate,
  onRemove,
  onToggleActive,
  onPickImage,
}: {
  zona: CentroConfig['zonas'][number];
  index: number;
  onUpdate: (field: 'title' | 'description', val: string) => void;
  onRemove: () => void;
  onToggleActive: () => void;
  onPickImage: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none">
          <GripVertical className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onPickImage}
          className="w-16 h-16 rounded-xl border border-border overflow-hidden bg-input flex items-center justify-center hover:border-[var(--color-accent-val)] transition-colors"
        >
          {zona.image ? (
            <img src={zona.image} alt={zona.title || `Zona ${index + 1}`} className="w-full h-full object-cover" />
          ) : (
            <ImageIcon className="w-5 h-5 text-[var(--color-text-secondary)]" />
          )}
        </button>
        <div className="flex-1 grid sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={zona.title ?? ''}
            onChange={(e) => onUpdate('title', e.target.value)}
            placeholder="Titulo de zona"
            className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          />
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onToggleActive}
              className={cn(
                'px-3 py-2 rounded-xl text-xs border transition-colors',
                zona.active === false
                  ? 'text-[var(--color-text-secondary)] border-border hover:text-[var(--color-text-primary)]'
                  : 'text-[var(--color-accent-val)] border-[var(--color-accent-border)] bg-[var(--color-accent-dim)]'
              )}
            >
              {zona.active === false ? 'Inactiva' : 'Activa'}
            </button>
            <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      <textarea
        value={zona.description ?? ''}
        onChange={(e) => onUpdate('description', e.target.value)}
        rows={2}
        placeholder="Descripcion"
        className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none text-sm"
      />
    </div>
  );
}

function SortableGaleriaStatItem({
  stat,
  index,
  onUpdate,
  onRemove,
}: {
  stat: GaleriaStat;
  index: number;
  onUpdate: (field: 'value' | 'label', val: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none">
            <GripVertical className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={stat.value ?? ''}
            onChange={(e) => onUpdate('value', e.target.value)}
            placeholder="Valor (ej: 200+)"
            className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={stat.label ?? ''}
            onChange={(e) => onUpdate('label', e.target.value)}
            placeholder="Etiqueta"
            className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          />
          <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableGaleriaTrainingItem({
  training,
  index,
  onUpdate,
  onRemove,
  onToggleActive,
  onPickMedia,
}: {
  training: GaleriaTrainingItem;
  index: number;
  onUpdate: (field: 'title' | 'mediaType', value: string) => void;
  onRemove: () => void;
  onToggleActive: () => void;
  onPickMedia: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none">
          <GripVertical className="w-4 h-4" />
        </button>
        <button type="button" onClick={onPickMedia} className="w-16 h-16 rounded-xl border border-border overflow-hidden bg-input flex items-center justify-center hover:border-[var(--color-accent-val)] transition-colors">
          {training.mediaUrl ? (
            training.mediaType === 'video' ? (
              <VideoFramePreview
                src={training.mediaUrl}
                title={training.title || `Entrenamiento ${index + 1}`}
                className="w-full h-full"
                iconContainerClassName="p-1.5 rounded-full bg-black/45 backdrop-blur-sm"
                iconClassName="w-5 h-5 text-white/80"
              />
            ) : (
              <img src={training.mediaUrl} alt={training.title || `Entrenamiento ${index + 1}`} className="w-full h-full object-cover" />
            )
          ) : (
            <ImageIcon className="w-5 h-5 text-[var(--color-text-secondary)]" />
          )}
        </button>
        <div className="flex-1 grid sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={training.title ?? ''}
            onChange={(e) => onUpdate('title', e.target.value)}
            placeholder="Titulo de entrenamiento"
            className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          />
          <select
            value={training.mediaType ?? 'image'}
            onChange={(e) => onUpdate('mediaType', e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          >
            <option value="image">Imagen</option>
            <option value="video">Video</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onToggleActive}
          className={cn(
            'px-3 py-2 rounded-xl text-xs border transition-colors',
            training.active === false
              ? 'text-[var(--color-text-secondary)] border-border hover:text-[var(--color-text-primary)]'
              : 'text-[var(--color-accent-val)] border-[var(--color-accent-border)] bg-[var(--color-accent-dim)]'
          )}
        >
          {training.active === false ? 'Inactivo' : 'Activo'}
        </button>
        <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SortableGaleriaResultadoItem({
  resultado,
  index,
  onUpdate,
  onRemove,
  onToggleActive,
}: {
  resultado: GaleriaResultado;
  index: number;
  onUpdate: (field: 'metric' | 'period' | 'name' | 'label' | 'achievement', val: string) => void;
  onRemove: () => void;
  onToggleActive: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none">
          <GripVertical className="w-4 h-4" />
        </button>
        <input
          type="text"
          value={resultado.name ?? ''}
          onChange={(e) => onUpdate('name', e.target.value)}
          placeholder="Nombre"
          className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
        />
        <button
          type="button"
          onClick={onToggleActive}
          className={cn(
            'px-3 py-2 rounded-xl text-xs border transition-colors',
            resultado.active === false
              ? 'text-[var(--color-text-secondary)] border-border hover:text-[var(--color-text-primary)]'
              : 'text-[var(--color-accent-val)] border-[var(--color-accent-border)] bg-[var(--color-accent-dim)]'
          )}
        >
          {resultado.active === false ? 'Inactivo' : 'Activo'}
        </button>
        <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <input type="text" value={resultado.metric ?? ''} onChange={(e) => onUpdate('metric', e.target.value)} placeholder="Metrica (ej: -18 kg)" className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm" />
        <input type="text" value={resultado.period ?? ''} onChange={(e) => onUpdate('period', e.target.value)} placeholder="Periodo (ej: en 4 meses)" className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm" />
        <input type="text" value={resultado.label ?? ''} onChange={(e) => onUpdate('label', e.target.value)} placeholder="Etiqueta" className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm" />
      </div>
      <textarea value={resultado.achievement ?? ''} onChange={(e) => onUpdate('achievement', e.target.value)} placeholder="Descripcion del resultado" rows={2} className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none text-sm" />
    </div>
  );
}

function SortableContactoCardItem({
  card,
  index,
  onUpdate,
  onRemove,
  onToggleActive,
}: {
  card: ContactoCard;
  index: number;
  onUpdate: (field: 'icon' | 'title' | 'content' | 'linkText' | 'linkUrl', val: string) => void;
  onRemove: () => void;
  onToggleActive: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
      <div className="flex items-start gap-3">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none mt-3">
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="w-16 shrink-0">
          <label className="block text-xs text-[var(--color-text-secondary)] mb-2">Icono</label>
          <IconPicker value={card.icon ?? 'MapPin'} onChange={(icon) => onUpdate('icon', icon)} />
        </div>
        <div className="flex-1 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Titulo</label>
            <input
              type="text"
              value={card.title ?? ''}
              onChange={(e) => onUpdate('title', e.target.value)}
              placeholder="Titulo"
              className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onToggleActive}
              className={cn(
                'px-3 py-2 rounded-xl text-xs border transition-colors mt-5',
                card.active === false
                  ? 'text-[var(--color-text-secondary)] border-border hover:text-[var(--color-text-primary)]'
                  : 'text-[var(--color-accent-val)] border-[var(--color-accent-border)] bg-[var(--color-accent-dim)]'
              )}
            >
              {card.active === false ? 'Inactiva' : 'Activa'}
            </button>
            <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl mt-5">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Contenido</label>
        <textarea
          value={card.content ?? ''}
          onChange={(e) => onUpdate('content', e.target.value)}
          rows={2}
          placeholder="Contenido de la tarjeta"
          className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none text-sm"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Texto enlace</label>
          <input
            type="text"
            value={card.linkText ?? ''}
            onChange={(e) => onUpdate('linkText', e.target.value)}
            placeholder="Enviar mensaje directo"
            className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1">URL enlace</label>
          <input
            type="text"
            value={card.linkUrl ?? ''}
            onChange={(e) => onUpdate('linkUrl', e.target.value)}
            placeholder="https://... | tel:... | mailto:..."
            className="w-full px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function SortableContactoSubjectItem({
  subject,
  index,
  onUpdate,
  onRemove,
}: {
  subject: string;
  index: number;
  onUpdate: (val: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: index.toString() });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="p-3 rounded-xl bg-muted/30 border border-border flex items-center gap-2">
      <button type="button" {...attributes} {...listeners} className="cursor-grab text-[var(--color-text-muted)] hover:text-white touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <input
        type="text"
        value={subject ?? ''}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder="Asunto"
        className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
      />
      <button type="button" onClick={onRemove} className="p-2 text-destructive hover:bg-destructive/10 rounded-xl">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function AdminPage() {
  const { user, userProfile, loading: authLoading, login, loginWithGoogle, logout, resetPassword, refreshUserProfile, isAdmin } = useAuth();
  const pathname = usePathname();

  // Role checks
  const isTrainerRole = userProfile?.role === 'trainer';
  const canAccessAdmin = isAdmin || isTrainerRole;

  // Helper: check if a URL is a valid remote image (not a stale local path)
  const isValidImageUrl = (url?: string) => url && url.startsWith('http');

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [clients, setClients] = useState<UserProfile[]>([]);
  const [cmsContent, setCmsContent] = useState<CMSContent | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>('Inicio');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const switchTab = (tab: TabType) => { setActiveTab(tab); setSidebarOpen(false); };
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  // Estado para aprobación con campos extra
  const [approvalData, setApprovalData] = useState<{ assignedTrainer: string; sessionType: string }>({
    assignedTrainer: '',
    sessionType: '',
  });
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // Estado para modal "Modificar Franja"
  const [showEditSlotModal, setShowEditSlotModal] = useState(false);
  const [editSlotData, setEditSlotData] = useState<TimeSlot>({ date: '', time: '' });

  // Estado para horarios bloqueados
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);

  // Interactive blocking calendar state
  const nowCal = new Date();
  const [calYear, setCalYear] = useState(nowCal.getFullYear());
  const [calMonth, setCalMonth] = useState(nowCal.getMonth() + 1);
  const [calSelectedDay, setCalSelectedDay] = useState<number | null>(null);
  const [pendingBlocks, setPendingBlocks] = useState<Set<string>>(new Set());
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [savingBlocks, setSavingBlocks] = useState(false);

  // CMS Edit States
  const [editedContent, setEditedContent] = useState<CMSContent | null>(null);
  const [editedServices, setEditedServices] = useState<Service[]>([]);
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [editingTestimonial, setEditingTestimonial] = useState<Testimonial | null>(null);
  const [newTestimonial, setNewTestimonial] = useState<Omit<Testimonial, 'id' | 'approved'>>({
    name: '',
    role: '',
    content: '',
    rating: 5,
  });

  // Image Manager State
  const [activeImageManager, setActiveImageManager] = useState<{
    folder: string;
    currentUrl?: string;
    onSelect: (url: string) => void;
  } | null>(null);

  // Branding / Logo
  const { fetchFolders: fetchMediaFolders } = useMediaLibrary();
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig | null>(null);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [sandraPickerOpen, setSandraPickerOpen] = useState(false);
  const [centroPickerOpen, setCentroPickerOpen] = useState(false);
  const [centroPickerIndex, setCentroPickerIndex] = useState<number | null>(null);
  const [galeriaTrainingPickerOpen, setGaleriaTrainingPickerOpen] = useState(false);
  const [galeriaTrainingPickerIndex, setGaleriaTrainingPickerIndex] = useState<number | null>(null);
  const [heroBackgroundPickerOpen, setHeroBackgroundPickerOpen] = useState(false);
  const [aboutHomePickerOpen, setAboutHomePickerOpen] = useState(false);

  // Autenticación admin
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [adminAuthMode, setAdminAuthMode] = useState<'login' | 'forgot-password'>('login');

  // Trainer management state
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainerProfile, setTrainerProfile] = useState<Trainer | null>(null);
  const [trainerAppointments, setTrainerAppointments] = useState<Appointment[]>([]);
  const [editingNotes, setEditingNotes] = useState<{ id: string; notes: string } | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  // Client search
  const [clientSearch, setClientSearch] = useState('');

  // Site config (dynamic time slots)
  const [siteConfig, setSiteConfig] = useState<SiteConfig>({ startHour: 8, endHour: 20, slotInterval: 30, bonoExpirationMonths: 1 });
  const [editConfig, setEditConfig] = useState<SiteConfig>({ startHour: 8, endHour: 20, slotInterval: 30, bonoExpirationMonths: 1 });
  const [savingConfig, setSavingConfig] = useState(false);
  const timeSlots = generateTimeSlots(siteConfig);

  // Bonos
  const [editBonoConfig, setEditBonoConfig] = useState(1);
  const [savingBonoConfig, setSavingBonoConfig] = useState(false);
  const [clientBonos, setClientBonos] = useState<Record<string, Bono | null>>({});
  const [showAssignBonoModal, setShowAssignBonoModal] = useState(false);
  const [assignBonoClient, setAssignBonoClient] = useState<UserProfile | null>(null);
  const [assignBonoTamano, setAssignBonoTamano] = useState<240 | 360 | 480>(240);
  const [savingBono, setSavingBono] = useState(false);
  const [showBonoHistoryModal, setShowBonoHistoryModal] = useState(false);
  const [bonoHistoryData, setBonoHistoryData] = useState<Bono[]>([]);
  const [bonoHistoryClientName, setBonoHistoryClientName] = useState('');
  const [clientAppointmentsHistory, setClientAppointmentsHistory] = useState<Appointment[]>([]);
  const [showDeleteBonoModal, setShowDeleteBonoModal] = useState(false);
  const [deleteBonoClient, setDeleteBonoClient] = useState<UserProfile | null>(null);

  // Delete appointments when blocking
  const [deleteOnBlock, setDeleteOnBlock] = useState(false);

  // Cargar datos desde Firestore
  const refreshData = async () => {
    const [appts, svcs, tests, cms, usersList, blocked, trainersList, config, branding, centroConfig, galeriaConfig] = await Promise.all([
      getAppointments(),
      getServices(),
      getTestimonials(),
      getSiteContent(),
      getUsers(),
      getBlockedSlots(),
      getTrainers(),
      getSiteConfig(),
      getBrandingConfig(),
      getCentroConfigFS(),
      getGaleriaConfigFS(),
    ]);
    setAppointments(appts);
    setServices(svcs);
    setEditedServices(svcs);
    setTestimonials(tests);
    setClients(usersList);
    setBlockedSlots(blocked);
    setTrainers(trainersList);
    setSiteConfig(config);
    setEditConfig(config);
    setEditBonoConfig(config.bonoExpirationMonths || 1);
    setBrandingConfig(branding);
    if (cms) {
      const mergedCms = {
        ...cms,
        galeria: galeriaConfig ?? cms.galeria ?? defaultCMS.galeria,
        centro: centroConfig ?? defaultCMS.centro,
      };
      // Normalize Sandra achievements: if Firestore still has old string[] format, reset to []
      if (
        mergedCms.sandra?.achievements?.length > 0 &&
        typeof (mergedCms.sandra.achievements as unknown[])[0] !== 'object'
      ) {
        mergedCms.sandra = { ...mergedCms.sandra, achievements: [] };
      }
      setCmsContent(mergedCms);
      setEditedContent(mergedCms);
    }

    // Bonos: expirar vencidos y cargar mapa de bonos activos por cliente
    await expireOverdueBonos();
    const activeBonos = await getAllActiveBonos();
    const bonoMap: Record<string, Bono | null> = {};
    for (const bono of activeBonos) {
      bonoMap[bono.userId] = bono;
    }
    setClientBonos(bonoMap);
  };

  // Cargar datos específicos del entrenador
  const refreshTrainerData = async () => {
    if (!user) return;
    const tProfile = await getTrainerByUid(user.uid);
    setTrainerProfile(tProfile);
    if (tProfile) {
      const appts = await getAppointmentsByTrainer(tProfile.id);
      setTrainerAppointments(appts);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      refreshData().catch(console.error);
      fetchMediaFolders().catch(console.error);
    } else if (isTrainerRole) {
      // Trainers only load their own data
      refreshTrainerData().catch(console.error);
    }
  }, [isAdmin, isTrainerRole]);

  // Stats
  const stats = {
    total: appointments.length,
    pending: appointments.filter((a) => a.status === 'pending').length,
    approved: appointments.filter((a) => a.status === 'approved').length,
    rejected: appointments.filter((a) => a.status === 'rejected').length,
    services: services.length,
    testimonials: testimonials.filter(t => t.approved).length,
  };

  // Filtrar citas
  const filteredAppointments = statusFilter === 'all'
    ? appointments
    : appointments.filter((a) => a.status === statusFilter);
  const clientsByUid = useMemo(() => new Map(clients.map((client) => [client.uid, client])), [clients]);
  const clientsByEmail = useMemo(() => new Map(clients.map((client) => [client.email, client])), [clients]);

  const getClientForAppointment = (appointment: Appointment): UserProfile | undefined =>
    clientsByUid.get(appointment.userId) ?? clientsByEmail.get(appointment.email);

  // Manejar inicio de sesión admin con Firebase Auth
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    setLoginSuccess('');

    const result = await login(loginForm.email, loginForm.password);
    if (!result.success) {
      setLoginError(result.message);
    }
    setLoginLoading(false);
  };

  const handleGoogleLoginAdmin = async () => {
    setLoginLoading(true);
    setLoginError('');
    setLoginSuccess('');

    const result = await loginWithGoogle();
    if (!result.success) {
      setLoginError(result.message);
    }
    // Si success, el onAuthStateChanged cargará el perfil y canAccessAdmin se evaluará
    setLoginLoading(false);
  };

  const handleAdminForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    setLoginSuccess('');

    const result = await resetPassword(loginForm.email);
    if (result.success) {
      setLoginSuccess(result.message);
    } else {
      setLoginError(result.message);
    }
    setLoginLoading(false);
  };

  // Manejar actualización de estado
  const handleStatusUpdate = async (
    id: string,
    status: 'pending' | 'approved' | 'rejected',
    extraFields?: { assignedTrainer?: string; sessionType?: string; approvedSlot?: TimeSlot }
  ) => {
    // Encontrar la cita actual para saber su estado previo
    const currentAppt = appointments.find(a => a.id === id);
    const prevStatus = currentAppt?.status;

    await updateAppointmentStatusFS(id, status, extraFields);

    // Mantener slot_occupancy sincronizado
    // Si pasa a 'approved', incrementar el aforo de todos los bloques de 30min cubiertos
    if (status === 'approved') {
      const slot = extraFields?.approvedSlot || currentAppt?.preferredSlots?.[0];
      if (slot && currentAppt) {
        const durationMinutes = parseInt(currentAppt.duration, 10);
        await incrementSlotOccupancy(slot.date, slot.time, durationMinutes);
      }
      // Descontar minutos del bono activo del usuario
      if (currentAppt) {
        const activeBono = await getActiveBonoByUser(currentAppt.userId);
        const durationMinutes = parseInt(currentAppt.duration, 10);
        if (activeBono && getBonoMinutosRestantes(activeBono) >= durationMinutes) {
          await deductBonoMinutes(activeBono.id, durationMinutes, {
            fecha: new Date().toISOString(),
            tipo: currentAppt.serviceType,
            duracion: currentAppt.duration,
            appointmentId: id,
          });
        }
      }
    }
    // Si ESTABA aprobada y ahora cambia a otro estado, decrementar
    if (prevStatus === 'approved' && status !== 'approved') {
      const slot = currentAppt?.approvedSlot || currentAppt?.preferredSlots?.[0];
      if (slot && currentAppt) {
        const durationMinutes = parseInt(currentAppt.duration, 10);
        await decrementSlotOccupancy(slot.date, slot.time, durationMinutes);
      }
      // Devolver minutos al bono si tenía una entrada para esta cita
      if (currentAppt) {
        const userBonos = await getBonosByUser(currentAppt.userId);
        const bonoWithEntry = userBonos.find(b => b.historial.some(h => h.appointmentId === id));
        if (bonoWithEntry) {
          await returnBonoMinutes(bonoWithEntry.id, id);
        }
      }
    }

    await addActivityLog({ action: `appointment_${status}`, adminEmail: user?.email || 'unknown', details: `Cita ID: ${id}` });
    await refreshData();
    setShowApprovalModal(false);
    setApprovalData({ assignedTrainer: '', sessionType: '' });
    setSelectedAppointmentId(null);
  };

  // Manejar guardado de CMS
  const handleSaveCMS = async () => {
    if (!editedContent) return;
    await updateSiteContent(editedContent);
    await addActivityLog({ action: 'cms_contacto_updated', adminEmail: user?.email || 'unknown' });
    await refreshData();
    const t = toast({ title: 'Contenido actualizado', description: 'Los cambios se han guardado correctamente.' });
    setTimeout(() => t.dismiss(), 3500);
  };

  // Manejar guardado de Sandra
  const handleSaveSandra = async () => {
    if (!editedContent) return;
    await updateSandraDataFS(editedContent.sandra);
    await addActivityLog({ action: 'cms_sandra_updated', adminEmail: user?.email || 'unknown' });
    await refreshData();
    const t = toast({ title: 'Sandra actualizada', description: 'Los cambios se han guardado correctamente.' });
    setTimeout(() => t.dismiss(), 3500);
  };

  // Manejar guardado del Centro
  const handleSaveCentro = async () => {
    if (!editedContent) return;
    await updateCentroConfigFS(editedContent.centro);
    await addActivityLog({ action: 'cms_centro_updated', adminEmail: user?.email || 'unknown' });
    await refreshData();
    const t = toast({ title: 'Centro actualizado', description: 'Los cambios se han guardado correctamente.' });
    setTimeout(() => t.dismiss(), 3500);
  };

  // Manejar guardado de la Galería
  const handleSaveGaleria = async () => {
    if (!editedContent?.galeria) return;
    await updateGaleriaConfigFS(editedContent.galeria);
    await addActivityLog({ action: 'cms_galeria_updated', adminEmail: user?.email || 'unknown' });
    await refreshData();
    const t = toast({ title: 'Galeria actualizada', description: 'Los cambios se han guardado correctamente.' });
    setTimeout(() => t.dismiss(), 3500);
  };

  // Manejar guardado de servicios (CMS)
  const handleSaveServicios = async () => {
    if (!editedContent) return;
    // 1. Guardar header + FAQs en site_content/main
    await updateSiteContent(editedContent);
    // 2. Detectar eliminados y borrarlos
    const originalIds = services.map(s => s.id);
    const keptIds = editedServices.filter(s => !s.id.startsWith('new-')).map(s => s.id);
    const toDelete = originalIds.filter(id => !keptIds.includes(id));
    await Promise.all(toDelete.map(id => deleteServiceFS(id)));
    // 3. Añadir nuevos y actualizar existentes (con orden actualizado)
    await Promise.all(editedServices.map((s, i) => {
      const { id, ...data } = s;
      const withOrder = { ...data, order: i + 1 };
      if (id.startsWith('new-')) return addServiceFS(withOrder);
      return updateServiceFS(id, withOrder);
    }));
    await addActivityLog({ action: 'services_updated', adminEmail: user?.email || 'unknown' });
    await refreshData();
    const t = toast({ title: 'Servicios actualizados', description: 'Los cambios se han guardado correctamente.' });
    setTimeout(() => t.dismiss(), 3500);
  };

  // Servicios helpers (inline)
  const updateServiceField = (id: string, field: keyof Service, value: unknown) => {
    setEditedServices(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };
  const updateServiceFeature = (id: string, i: number, val: string) => {
    setEditedServices(prev => prev.map(s => {
      if (s.id !== id) return s;
      const features = [...(s.features ?? [])];
      features[i] = val;
      return { ...s, features };
    }));
  };
  const removeServiceFeature = (id: string, i: number) => {
    setEditedServices(prev => prev.map(s => s.id !== id ? s : { ...s, features: (s.features ?? []).filter((_, j) => j !== i) }));
  };
  const addServiceFeature = (id: string) => {
    setEditedServices(prev => prev.map(s => s.id !== id ? s : { ...s, features: [...(s.features ?? []), ''] }));
  };
  const removeEditedService = (id: string) => {
    setEditedServices(prev => prev.filter(s => s.id !== id));
    setExpandedServiceId(prev => prev === id ? null : prev);
  };
  const addNewService = () => {
    const newId = `new-${Date.now()}`;
    const newSvc: Service = { id: newId, title: '', description: '', duration: '', price: '', icon: 'Dumbbell', features: [], ctaText: 'Reservar', ctaLink: '/portal', active: true, order: editedServices.length + 1 };
    setEditedServices(prev => [...prev, newSvc]);
    setExpandedServiceId(newId);
  };
  const handleServiceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = editedServices.findIndex(s => s.id === active.id);
      const newIndex = editedServices.findIndex(s => s.id === over!.id);
      setEditedServices(arrayMove(editedServices, oldIndex, newIndex));
    }
  };

  // FAQs helpers
  const updateFaq = (i: number, field: 'question' | 'answer', val: string) => {
    const faqs = [...(editedContent?.servicesFaqs ?? [])];
    faqs[i] = { ...faqs[i], [field]: val };
    setEditedContent(prev => prev ? { ...prev, servicesFaqs: faqs } as CMSContent : prev);
  };
  const removeFaq = (i: number) => {
    setEditedContent(prev => prev ? { ...prev, servicesFaqs: (prev.servicesFaqs ?? []).filter((_, j) => j !== i) } as CMSContent : prev);
  };
  const addFaq = () => {
    setEditedContent(prev => prev ? { ...prev, servicesFaqs: [...(prev.servicesFaqs ?? []), { question: '', answer: '' }] } as CMSContent : prev);
  };
  const handleFaqDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = Number(active.id);
      const newIndex = Number(over!.id);
      const newFaqs = arrayMove(editedContent!.servicesFaqs!, oldIndex, newIndex);
      setEditedContent(prev => prev ? { ...prev, servicesFaqs: newFaqs } as CMSContent : prev);
    }
  };

  const updateCentroField = (field: keyof CentroConfig, value: unknown) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        centro: {
          ...prev.centro,
          [field]: value,
        },
      } as CMSContent;
    });
  };

  const updateCentroZonaField = (index: number, field: 'title' | 'description', value: string) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const zonas = [...(prev.centro?.zonas ?? [])];
      zonas[index] = { ...zonas[index], [field]: value };
      return { ...prev, centro: { ...prev.centro, zonas } } as CMSContent;
    });
  };

  const toggleCentroZonaActive = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const zonas = [...(prev.centro?.zonas ?? [])];
      const current = zonas[index] ?? { image: '', title: '', description: '', active: true };
      zonas[index] = { ...current, active: current.active === false ? true : false };
      return { ...prev, centro: { ...prev.centro, zonas } } as CMSContent;
    });
  };

  const removeCentroZona = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const zonas = (prev.centro?.zonas ?? []).filter((_, i) => i !== index);
      return { ...prev, centro: { ...prev.centro, zonas } } as CMSContent;
    });
  };

  const addCentroZona = () => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const zonas = [...(prev.centro?.zonas ?? []), { image: '', title: '', description: '', active: true }];
      return { ...prev, centro: { ...prev.centro, zonas } } as CMSContent;
    });
  };

  const handleCentroZonasDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setEditedContent((prev) => {
        if (!prev) return prev;
        const zonas = prev.centro?.zonas ?? [];
        const oldIndex = Number(active.id);
        const newIndex = Number(over?.id);
        return { ...prev, centro: { ...prev.centro, zonas: arrayMove(zonas, oldIndex, newIndex) } } as CMSContent;
      });
    }
  };

  const updateGaleriaField = (field: keyof GaleriaContent, value: unknown) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        galeria: {
          ...prev.galeria,
          [field]: value,
        },
      } as CMSContent;
    });
  };

  const updateGaleriaStatField = (index: number, field: 'value' | 'label', value: string) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const stats = [...(prev.galeria?.stats ?? [])];
      stats[index] = { ...stats[index], [field]: value };
      return { ...prev, galeria: { ...prev.galeria, stats } } as CMSContent;
    });
  };

  const addGaleriaStat = () => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const stats = [...(prev.galeria?.stats ?? []), { value: '', label: '' }];
      return { ...prev, galeria: { ...prev.galeria, stats } } as CMSContent;
    });
  };

  const removeGaleriaStat = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const stats = (prev.galeria?.stats ?? []).filter((_, i) => i !== index);
      return { ...prev, galeria: { ...prev.galeria, stats } } as CMSContent;
    });
  };

  const handleGaleriaStatsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setEditedContent((prev) => {
        if (!prev) return prev;
        const stats = prev.galeria?.stats ?? [];
        return { ...prev, galeria: { ...prev.galeria, stats: arrayMove(stats, Number(active.id), Number(over?.id)) } } as CMSContent;
      });
    }
  };

  const updateGaleriaTrainingField = (index: number, field: 'title' | 'mediaType', value: string) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const trainings = [...(prev.galeria?.trainings ?? [])];
      trainings[index] = {
        ...trainings[index],
        [field]: field === 'mediaType' ? (value === 'video' ? 'video' : 'image') : value,
      };
      return { ...prev, galeria: { ...prev.galeria, trainings } } as CMSContent;
    });
  };

  const addGaleriaTraining = () => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const trainings = [...(prev.galeria?.trainings ?? []), { mediaUrl: '', mediaType: 'image', title: '', active: true }];
      return { ...prev, galeria: { ...prev.galeria, trainings } } as CMSContent;
    });
  };

  const removeGaleriaTraining = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const trainings = (prev.galeria?.trainings ?? []).filter((_, i) => i !== index);
      return { ...prev, galeria: { ...prev.galeria, trainings } } as CMSContent;
    });
  };

  const toggleGaleriaTrainingActive = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const trainings = [...(prev.galeria?.trainings ?? [])];
      const current = trainings[index] ?? { mediaUrl: '', mediaType: 'image', title: '', active: true };
      trainings[index] = { ...current, active: current.active === false ? true : false };
      return { ...prev, galeria: { ...prev.galeria, trainings } } as CMSContent;
    });
  };

  const handleGaleriaTrainingsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setEditedContent((prev) => {
        if (!prev) return prev;
        const trainings = prev.galeria?.trainings ?? [];
        return { ...prev, galeria: { ...prev.galeria, trainings: arrayMove(trainings, Number(active.id), Number(over?.id)) } } as CMSContent;
      });
    }
  };

  const updateGaleriaResultadoField = (index: number, field: 'metric' | 'period' | 'name' | 'label' | 'achievement', value: string) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const resultados = [...(prev.galeria?.resultados ?? [])];
      resultados[index] = { ...resultados[index], [field]: value };
      return { ...prev, galeria: { ...prev.galeria, resultados } } as CMSContent;
    });
  };

  const addGaleriaResultado = () => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const resultados = [...(prev.galeria?.resultados ?? []), { metric: '', period: '', name: '', achievement: '', label: '', active: true }];
      return { ...prev, galeria: { ...prev.galeria, resultados } } as CMSContent;
    });
  };

  const removeGaleriaResultado = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const resultados = (prev.galeria?.resultados ?? []).filter((_, i) => i !== index);
      return { ...prev, galeria: { ...prev.galeria, resultados } } as CMSContent;
    });
  };

  const toggleGaleriaResultadoActive = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const resultados = [...(prev.galeria?.resultados ?? [])];
      const current = resultados[index] ?? { metric: '', period: '', name: '', achievement: '', label: '', active: true };
      resultados[index] = { ...current, active: current.active === false ? true : false };
      return { ...prev, galeria: { ...prev.galeria, resultados } } as CMSContent;
    });
  };

  const handleGaleriaResultadosDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setEditedContent((prev) => {
        if (!prev) return prev;
        const resultados = prev.galeria?.resultados ?? [];
        return { ...prev, galeria: { ...prev.galeria, resultados: arrayMove(resultados, Number(active.id), Number(over?.id)) } } as CMSContent;
      });
    }
  };

  const updateContactoField = (field: keyof ContactoConfig, value: unknown) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contacto: {
          ...(prev.contacto ?? defaultCMS.contacto!),
          [field]: value,
        },
      } as CMSContent;
    });
  };

  const updateContactoCardField = (index: number, field: 'icon' | 'title' | 'content' | 'linkText' | 'linkUrl', value: string) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const cards = [...(contacto.cards ?? [])];
      cards[index] = { ...cards[index], [field]: value };
      return { ...prev, contacto: { ...contacto, cards } } as CMSContent;
    });
  };

  const addContactoCard = () => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const cards = [...(contacto.cards ?? []), { icon: 'MapPin', title: '', content: '', linkText: '', linkUrl: '', active: true }];
      return { ...prev, contacto: { ...contacto, cards } } as CMSContent;
    });
  };

  const removeContactoCard = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const cards = (contacto.cards ?? []).filter((_, i) => i !== index);
      return { ...prev, contacto: { ...contacto, cards } } as CMSContent;
    });
  };

  const toggleContactoCardActive = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const cards = [...(contacto.cards ?? [])];
      const current = cards[index] ?? { icon: 'MapPin', title: '', content: '', linkText: '', linkUrl: '', active: true };
      cards[index] = { ...current, active: current.active === false ? true : false };
      return { ...prev, contacto: { ...contacto, cards } } as CMSContent;
    });
  };

  const handleContactoCardsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setEditedContent((prev) => {
        if (!prev) return prev;
        const contacto = prev.contacto ?? defaultCMS.contacto!;
        const cards = contacto.cards ?? [];
        return { ...prev, contacto: { ...contacto, cards: arrayMove(cards, Number(active.id), Number(over?.id)) } } as CMSContent;
      });
    }
  };

  const updateContactoSubject = (index: number, value: string) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const subjects = [...(contacto.subjects ?? [])];
      subjects[index] = value;
      return { ...prev, contacto: { ...contacto, subjects } } as CMSContent;
    });
  };

  const addContactoSubject = () => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const subjects = [...(contacto.subjects ?? []), ''];
      return { ...prev, contacto: { ...contacto, subjects } } as CMSContent;
    });
  };

  const removeContactoSubject = (index: number) => {
    setEditedContent((prev) => {
      if (!prev) return prev;
      const contacto = prev.contacto ?? defaultCMS.contacto!;
      const subjects = (contacto.subjects ?? []).filter((_, i) => i !== index);
      return { ...prev, contacto: { ...contacto, subjects } } as CMSContent;
    });
  };

  const handleContactoSubjectsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setEditedContent((prev) => {
        if (!prev) return prev;
        const contacto = prev.contacto ?? defaultCMS.contacto!;
        const subjects = contacto.subjects ?? [];
        return { ...prev, contacto: { ...contacto, subjects: arrayMove(subjects, Number(active.id), Number(over?.id)) } } as CMSContent;
      });
    }
  };

  // Manejar guardado de testimonio
  const handleSaveTestimonial = async () => {
    if (editingTestimonial) {
      const isNew = editingTestimonial.id.startsWith('new-');
      if (isNew) {
        await addTestimonialFS({
          name: editingTestimonial.name,
          role: editingTestimonial.role,
          content: editingTestimonial.content,
          rating: editingTestimonial.rating,
        });
      } else {
        await updateTestimonialFS(editingTestimonial.id, editingTestimonial);
      }
      await addActivityLog({ action: isNew ? 'testimonial_created' : 'testimonial_updated', adminEmail: user?.email || 'unknown', details: editingTestimonial.name });
      await refreshData();
      setEditingTestimonial(null);
    }
  };

  // Login screen — si no está autenticado o no es admin
  if (authLoading) {
    return (
      <div className="h-screen -mt-20 flex items-center justify-center bg-[var(--color-bg-base)]">
        <div className="text-[var(--color-text-primary)]">Cargando...</div>
      </div>
    );
  }

  if (!user || !canAccessAdmin) {
    return (
      <div className="h-screen -mt-20 flex items-center justify-center px-4 bg-[var(--color-bg-base)]">
        <motion.div
          className="max-w-md w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard className="p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-accent-val)] to-emerald-bright mx-auto mb-4 flex items-center justify-center">
                {adminAuthMode === 'forgot-password' ? (
                  <KeyRound className="w-8 h-8 text-[var(--color-bg-base)]" />
                ) : (
                  <LayoutDashboard className="w-8 h-8 text-[var(--color-bg-base)]" />
                )}
              </div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                {adminAuthMode === 'forgot-password' ? 'Recuperar Contraseña' : 'Panel de Administración'}
              </h1>
              <p className="text-[var(--color-text-secondary)] text-sm">
                {adminAuthMode === 'forgot-password'
                  ? 'Te enviaremos un enlace para restablecer tu contraseña'
                  : 'Focus Club Vallecas'}
              </p>
            </div>

            {adminAuthMode === 'forgot-password' ? (
              <form onSubmit={handleAdminForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                    placeholder="tu@email.com"
                    required
                  />
                </div>

                {loginError && (
                  <p className="text-destructive text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {loginError}
                  </p>
                )}

                {loginSuccess && (
                  <p className="text-[var(--color-accent-val)] text-sm flex items-center gap-2">
                    <MailCheck className="w-4 h-4" />
                    {loginSuccess}
                  </p>
                )}

                <PremiumButton type="submit" variant="cta" className="w-full" loading={loginLoading}>
                  Enviar enlace
                </PremiumButton>

                <button
                  type="button"
                  onClick={() => { setAdminAuthMode('login'); setLoginError(''); setLoginSuccess(''); }}
                  className="w-full text-center text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors mt-2"
                >
                  Volver al inicio de sesión
                </button>
              </form>
            ) : (
              <>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                      placeholder="admin@focusclub.es"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                      Contraseña
                    </label>
                    <input
                      type="password"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                      placeholder="Introduce la contraseña"
                    />
                  </div>

                  {/* Forgot password link */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => { setAdminAuthMode('forgot-password'); setLoginError(''); setLoginSuccess(''); }}
                      className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors"
                    >
                      ¿Has olvidado tu contraseña?
                    </button>
                  </div>

                  {loginError && (
                    <p className="text-destructive text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {loginError}
                    </p>
                  )}
                  {user && !canAccessAdmin && (
                    <p className="text-destructive text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Esta cuenta no tiene permisos de administrador.
                    </p>
                  )}
                  <PremiumButton type="submit" variant="cta" className="w-full" disabled={!!user && !canAccessAdmin}>
                    Acceder
                  </PremiumButton>
                </form>

                {/* Separator */}
                <div className="flex items-center gap-3 my-4 text-xs text-[var(--color-text-secondary)]">
                  <div className="flex-1 border-t border-border" />
                  <span>o</span>
                  <div className="flex-1 border-t border-border" />
                </div>

                {/* Google Sign-In */}
                <button
                  type="button"
                  onClick={handleGoogleLoginAdmin}
                  disabled={loginLoading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-border bg-input hover:bg-border/50 text-[var(--color-text-primary)] text-sm font-medium transition-all disabled:opacity-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continuar con Google
                </button>

                {user && !canAccessAdmin && (
                  <div className="mt-4">
                    <PremiumButton variant="ghost" className="w-full" onClick={logout}>
                      Cerrar sesión e intentar con otra cuenta
                    </PremiumButton>
                  </div>
                )}
              </>
            )}

            <Link href="/" className="block text-center mt-6">
              <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                Volver al inicio
              </PremiumButton>
            </Link>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // ============================================
  // TRAINER-ONLY VIEW (no sidebar, limited access)
  // ============================================
  if (isTrainerRole && !isAdmin) {
    const now = new Date();
    const upcomingAppts = trainerAppointments
      .filter(a => a.approvedSlot && new Date(a.approvedSlot.date + 'T' + a.approvedSlot.time) >= now)
      .sort((a, b) => {
        const da = new Date(a.approvedSlot!.date + 'T' + a.approvedSlot!.time);
        const db = new Date(b.approvedSlot!.date + 'T' + b.approvedSlot!.time);
        return da.getTime() - db.getTime();
      });
    const pastAppts = trainerAppointments
      .filter(a => a.approvedSlot && new Date(a.approvedSlot.date + 'T' + a.approvedSlot.time) < now)
      .sort((a, b) => {
        const da = new Date(a.approvedSlot!.date + 'T' + a.approvedSlot!.time);
        const db = new Date(b.approvedSlot!.date + 'T' + b.approvedSlot!.time);
        return db.getTime() - da.getTime();
      });

    const handleSaveNotes = async () => {
      if (!editingNotes) return;
      setSavingNotes(true);
      try {
        await updateTrainerNotes(editingNotes.id, editingNotes.notes);
        await refreshTrainerData();
        setEditingNotes(null);
      } catch (err) {
        console.error('Error saving notes:', err);
        alert('Error al guardar las notas.');
      }
      setSavingNotes(false);
    };

    const renderTrainerAppointmentCard = (appt: Appointment, isPast: boolean) => (
      <GlassCard key={appt.id} className={cn('p-5', isPast && 'opacity-70')}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--color-accent-val)] to-emerald-bright flex items-center justify-center text-[var(--color-bg-base)] font-bold">
                {appt.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-semibold text-[var(--color-text-primary)]">{appt.name}</h3>
                {appt.sessionType && (
                  <span className="px-2 py-0.5 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-xs font-medium uppercase">
                    {appt.sessionType}
                  </span>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {appt.approvedSlot && (
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                  <Calendar className="w-4 h-4 text-[var(--color-accent-val)]" />
                  <span className="text-[var(--color-text-primary)]">
                    {new Date(appt.approvedSlot.date).toLocaleDateString('es-ES', {
                      weekday: 'long', day: 'numeric', month: 'long',
                    })}
                  </span>
                </div>
              )}
              {appt.approvedSlot && (
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                  <Clock className="w-4 h-4 text-[var(--color-accent-val)]" />
                  <span className="text-[var(--color-text-primary)]">{appt.approvedSlot.time}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                <Award className="w-4 h-4 text-[var(--color-accent-val)]" />
                <span className="text-[var(--color-text-primary)]">{serviceLabels[appt.serviceType] || appt.serviceType}</span>
              </div>
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                <Clock className="w-4 h-4 text-[var(--color-accent-val)]" />
                <span className="text-[var(--color-text-primary)]">{durationLabels[appt.duration] || appt.duration + ' min'}</span>
              </div>
            </div>

            {/* Trainer Notes */}
            {editingNotes?.id === appt.id ? (
              <div className="space-y-2">
                <label className="text-xs text-[var(--color-text-secondary)]">Notas del entrenador:</label>
                <textarea
                  value={editingNotes.notes}
                  onChange={(e) => setEditingNotes({ ...editingNotes, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-input border border-border text-[var(--color-text-primary)] text-sm focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                  rows={3}
                  placeholder="Escribe tus notas sobre esta sesión..."
                />
                <div className="flex gap-2">
                  <PremiumButton
                    variant="cta"
                    size="sm"
                    icon={<Save className="w-3.5 h-3.5" />}
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                  >
                    {savingNotes ? 'Guardando...' : 'Guardar'}
                  </PremiumButton>
                  <PremiumButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingNotes(null)}
                  >
                    Cancelar
                  </PremiumButton>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                {appt.trainerNotes ? (
                  <div className="flex-1 p-2 rounded-lg bg-muted/30">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">Tus notas:</p>
                    <p className="text-[var(--color-text-primary)] text-sm">{appt.trainerNotes}</p>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-text-secondary)] italic">Sin notas</p>
                )}
                <button
                  onClick={() => setEditingNotes({ id: appt.id, notes: appt.trainerNotes || '' })}
                  className="text-[var(--color-accent-val)] hover:text-[var(--color-accent-val)]/80 transition-colors p-1"
                  title="Editar notas"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    );

    return (
      <div className="min-h-screen -mt-20 bg-[var(--color-bg-base)]">
        {/* Header */}
        <header className="glass-dark border-b border-border sticky top-0 z-40">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                  <Image src={brandingConfig?.logoUrl ?? '/imagenes/logo.jpeg'} alt="Focus Club" width={32} height={32} className="w-full h-full object-cover" unoptimized={!!brandingConfig?.logoUrl} />
                </div>
                <div>
                  <span className="font-bold text-[var(--color-text-primary)]">Panel Entrenador</span>
                  {trainerProfile && (
                    <span className="text-xs text-[var(--color-text-secondary)] ml-2">({trainerProfile.name})</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <PremiumButton
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw className="w-4 h-4" />}
                  onClick={() => refreshTrainerData()}
                >
                  <span className="hidden sm:inline">Actualizar</span>
                </PremiumButton>
                <PremiumButton
                  variant="ghost"
                  size="sm"
                  onClick={() => logout()}
                  icon={<LogOut className="w-4 h-4" />}
                >
                  <span className="hidden sm:inline">Salir</span>
                </PremiumButton>
              </div>
            </div>
          </div>
        </header>

        <div className="container mx-auto px-4 py-8 max-w-4xl">
          {!trainerProfile ? (
            <GlassCard className="p-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-400" />
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">Perfil no encontrado</h2>
              <p className="text-[var(--color-text-secondary)]">
                Tu cuenta tiene rol de entrenador, pero no se ha encontrado un perfil en la colección de trainers.
                Contacta con la administradora.
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-8">
              {/* Upcoming Appointments */}
              <div>
                <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-[var(--color-accent-val)]" />
                  Próximos entrenamientos
                  {upcomingAppts.length > 0 && (
                    <span className="text-sm font-normal text-[var(--color-text-secondary)]">({upcomingAppts.length})</span>
                  )}
                </h2>
                {upcomingAppts.length > 0 ? (
                  <div className="space-y-4">
                    {upcomingAppts.map(a => renderTrainerAppointmentCard(a, false))}
                  </div>
                ) : (
                  <GlassCard className="p-8 text-center">
                    <Calendar className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-secondary)] opacity-40" />
                    <p className="text-[var(--color-text-secondary)]">No tienes entrenamientos programados.</p>
                  </GlassCard>
                )}
              </div>

              {/* Past Appointments */}
              {pastAppts.length > 0 && (
                <div>
                  <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-[var(--color-text-secondary)]" />
                    Entrenamientos anteriores
                    <span className="text-sm font-normal text-[var(--color-text-secondary)]">({pastAppts.length})</span>
                  </h2>
                  <div className="space-y-4">
                    {pastAppts.map(a => renderTrainerAppointmentCard(a, true))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================
  // MAIN ADMIN PANEL
  // ============================================

  return (
    <div className="min-h-screen -mt-20 bg-[var(--color-bg-base)]">
      {/* Header */}
      <header className="glass-dark border-b border-border sticky top-0 z-40">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-white/5 transition-colors"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <Link href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                  <Image src={brandingConfig?.logoUrl ?? '/imagenes/logo.jpeg'} alt="Focus Club" width={32} height={32} className="w-full h-full object-cover" unoptimized={!!brandingConfig?.logoUrl} />
                </div>
                <span className="font-bold text-[var(--color-text-primary)] hidden sm:block">Focus Club Admin</span>
              </Link>
            </div>

            <div className="flex items-center gap-2">
              <Link href="/">
                <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                  <span className="hidden sm:inline">Ver web</span>
                </PremiumButton>
              </Link>
              <PremiumButton
                variant="ghost"
                size="sm"
                onClick={() => logout()}
                icon={<LogOut className="w-4 h-4" />}
              >
                <span className="hidden sm:inline">Salir</span>
              </PremiumButton>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-[260px_1fr] gap-8">
          {/* Mobile sidebar overlay */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-30 bg-[var(--color-bg-base)]/60 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <aside className={cn(
            'space-y-1 lg:block',
            sidebarOpen
              ? 'fixed inset-y-0 left-0 z-40 w-64 bg-[#0A110D] border-r border-border p-4 pt-20 overflow-y-auto shadow-2xl lg:static lg:w-auto lg:border-0 lg:p-0 lg:pt-0 lg:shadow-none lg:bg-transparent'
              : 'hidden'
          )}>
            <p className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 px-3">Principal</p>

            <button
              onClick={() => switchTab('Inicio')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Inicio'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <BarChart3 className="w-5 h-5" />
              <span className="font-medium">Dashboard</span>
            </button>

            <button
              onClick={() => switchTab('appointments')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'appointments'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Calendar className="w-5 h-5" />
              <span className="font-medium">Citas</span>
              {stats.pending > 0 && (
                <span className="ml-auto bg-yellow-500/20 text-yellow-400 text-xs px-2 py-0.5 rounded-full">
                  {stats.pending}
                </span>
              )}
            </button>

            <button
              onClick={() => switchTab('availability')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'availability'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <CalendarOff className="w-5 h-5" />
              <span className="font-medium">Disponibilidad</span>
              {blockedSlots.length > 0 && (
                <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{blockedSlots.length}</span>
              )}
            </button>

            <button
              onClick={() => switchTab('clients')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'clients'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Users className="w-5 h-5" />
              <span className="font-medium">Clientes</span>
            </button>

            <button
              onClick={() => switchTab('team')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'team'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Dumbbell className="w-5 h-5" />
              <span className="font-medium">Equipo</span>
              {trainers.length > 0 && (
                <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{trainers.length}</span>
              )}
            </button>

            <p className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider mt-6 mb-3 px-3">Gestión</p>

            <button
              onClick={() => switchTab('testimonials')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'testimonials'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Star className="w-5 h-5" />
              <span className="font-medium">Testimonios</span>
              <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{stats.testimonials}</span>
            </button>

            <Link
              href="/admin/medios"
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                pathname?.startsWith('/admin/medios')
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Images className="w-5 h-5" />
              <span className="font-medium">Medios</span>
            </Link>

            <button
              onClick={() => switchTab('config')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'config'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Configuración</span>
            </button>

            <p className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider mt-6 mb-3 px-3">CMS</p>

            <button
              onClick={() => switchTab('Hero')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Hero'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <ImageIcon className="w-5 h-5" />
              <span className="font-medium">Hero</span>
            </button>

            <button
              onClick={() => switchTab('Sandra')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Sandra'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <User className="w-5 h-5" />
              <span className="font-medium">Sandra</span>
            </button>

            <button
              onClick={() => switchTab('Centro')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Centro'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <MapPin className="w-5 h-5" />
              <span className="font-medium">El Centro</span>
            </button>

            <button
              onClick={() => switchTab('Servicios')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Servicios'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Layers className="w-5 h-5" />
              <span className="font-medium">Servicios</span>
            </button>

            <button
              onClick={() => switchTab('Galeria')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Galeria'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Images className="w-5 h-5" />
              <span className="font-medium">Galería</span>
            </button>

            <button
              onClick={() => switchTab('Contacto')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Contacto'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <Globe className="w-5 h-5" />
              <span className="font-medium">Contacto</span>
            </button>

            <button
              onClick={() => switchTab('Footer')}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left',
                activeTab === 'Footer'
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] shadow-lg shadow-emerald/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
              )}
            >
              <FileText className="w-5 h-5" />
              <span className="font-medium">Footer</span>
            </button>
          </aside>

          {/* Main Content */}
          <main>
            <AnimatePresence mode="wait">
              {/* ============================================
                  DASHBOARD
                  ============================================ */}
              {activeTab === 'Inicio' && (
                <motion.div
                  key="Inicio"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-6">Dashboard</h1>

                  {/* Stats Grid */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    {[
                      { label: 'Total Citas', value: stats.total, icon: Calendar, color: 'from-[var(--color-accent-val)] to-[#2d6a4f]' },
                      { label: 'Pendientes', value: stats.pending, icon: Clock, color: 'from-yellow-600 to-yellow-800' },
                      { label: 'Aprobadas', value: stats.approved, icon: CheckCircle, color: 'from-green-600 to-green-800' },
                      { label: 'Servicios', value: stats.services, icon: Award, color: 'from-[#2d6a4f] to-[var(--color-accent-val)]' },
                    ].map((stat, index) => (
                      <GlassCard key={index} className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                            <stat.icon className="w-6 h-6 text-white" />
                          </div>
                          <TrendingUp className="w-5 h-5 text-[var(--color-text-secondary)]" />
                        </div>
                        <div className="text-3xl font-bold text-[var(--color-text-primary)] mb-1">{stat.value}</div>
                        <div className="text-sm text-[var(--color-text-secondary)]">{stat.label}</div>
                      </GlassCard>
                    ))}
                  </div>

                  {/* Recent Appointments */}
                  <GlassCard className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Citas Recientes</h2>
                      <button
                        onClick={() => setActiveTab('appointments')}
                        className="text-[var(--color-accent-val)] text-sm hover:underline flex items-center gap-1"
                      >
                        Ver todas <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      {appointments.slice(0, 5).map((appointment) => {
                        const StatusIcon = statusConfig[appointment.status].icon;
                        const appointmentClient = getClientForAppointment(appointment);
                        return (
                          <div
                            key={appointment.id}
                            className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => {
                              setStatusFilter('all');
                              setActiveTab('appointments');
                              // Scroll to the appointment after tab switch
                              setTimeout(() => {
                                document.getElementById(`appt-${appointment.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }, 300);
                            }}
                          >
                            <div className="flex items-center gap-4">
                              {appointmentClient?.photoURL ? (
                                <img
                                  src={appointmentClient.photoURL}
                                  alt={appointment.name}
                                  className="w-10 h-10 rounded-full object-cover ring-2 ring-[var(--color-accent-border)]"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--color-accent-val)] to-emerald-bright flex items-center justify-center text-[var(--color-bg-base)] font-semibold">
                                  {appointment.name.charAt(0)}
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent-val)] transition-colors">{appointment.name}</p>
                                <p className="text-sm text-[var(--color-text-secondary)]">
                                  {serviceLabels[appointment.serviceType] || appointment.serviceType} - {durationLabels[appointment.duration]}
                                </p>
                              </div>
                            </div>
                            <span className={cn('px-3 py-1 rounded-full text-xs font-medium border', statusConfig[appointment.status].color)}>
                              {statusConfig[appointment.status].label}
                            </span>
                          </div>
                        );
                      })}
                      {appointments.length === 0 && (
                        <div className="text-center py-8 text-[var(--color-text-secondary)]">
                          <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p>No hay citas aún</p>
                        </div>
                      )}
                    </div>
                  </GlassCard>
                </motion.div>
              )}

              {/* ============================================
                  APPOINTMENTS
                  ============================================ */}
              {activeTab === 'appointments' && (
                <motion.div
                  key="appointments"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Gestión de Citas</h1>
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'pending', 'approved', 'rejected'] as StatusFilter[]).map(
                        (filter) => (
                          <button
                            key={filter}
                            onClick={() => setStatusFilter(filter)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                              statusFilter === filter
                                ? 'bg-accent text-[var(--color-bg-base)]'
                                : 'bg-muted text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                            )}
                          >
                            {filter === 'all' ? 'Todas' : statusConfig[filter].label}
                            {filter === 'pending' && stats.pending > 0 && (
                              <span className="ml-1">({stats.pending})</span>
                            )}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {filteredAppointments.map((appointment) => {
                      const StatusIcon = statusConfig[appointment.status].icon;
                      const appointmentClient = getClientForAppointment(appointment);
                      return (
                        <motion.div
                          id={`appt-${appointment.id}`}
                          key={appointment.id}
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <GlassCard className="p-6">
                            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                              <div className="flex-1 space-y-4">
                                <div className="flex items-center gap-3">
                                  {appointmentClient?.photoURL ? (
                                    <img
                                      src={appointmentClient.photoURL}
                                      alt={appointment.name}
                                      className="w-12 h-12 rounded-full object-cover ring-2 ring-[var(--color-accent-border)]"
                                    />
                                  ) : (
                                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--color-accent-val)] to-emerald-bright flex items-center justify-center text-[var(--color-bg-base)] font-bold text-lg">
                                      {appointment.name.charAt(0)}
                                    </div>
                                  )}
                                  <div>
                                    <h3 className="font-semibold text-[var(--color-text-primary)] text-lg">{appointment.name}</h3>
                                    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border', statusConfig[appointment.status].color)}>
                                      <StatusIcon className="w-3 h-3" />
                                      {statusConfig[appointment.status].label}
                                    </span>
                                  </div>
                                </div>

                                <div className="grid sm:grid-cols-2 gap-4">
                                  <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                                    <Mail className="w-4 h-4 text-[var(--color-accent-val)]" />
                                    <a href={`mailto:${appointment.email}`} className="hover:text-[var(--color-accent-val)] transition-colors text-sm">
                                      {appointment.email}
                                    </a>
                                  </div>
                                  <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                                    <Phone className="w-4 h-4 text-[var(--color-accent-val)]" />
                                    <a href={`tel:${appointment.phone}`} className="hover:text-[var(--color-accent-val)] transition-colors text-sm">
                                      {appointment.phone}
                                    </a>
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-4 text-sm">
                                  <div className="flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-[var(--color-accent-val)]" />
                                    <span className="text-[var(--color-text-primary)]">
                                      {appointment.preferredSlots[0]
                                        ? `${new Date(appointment.preferredSlots[0].date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} - ${appointment.preferredSlots[0].time}`
                                        : '—'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-[var(--color-accent-val)]" />
                                    <span className="text-[var(--color-text-primary)]">{durationLabels[appointment.duration]}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Dumbbell className="w-4 h-4 text-[var(--color-accent-val)]" />
                                    <span className="text-[var(--color-text-primary)]">{serviceLabels[appointment.serviceType] || appointment.serviceType}</span>
                                  </div>
                                </div>

                                {appointment.reason && (
                                  <div className="p-3 rounded-lg bg-muted/30">
                                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">Comentario:</p>
                                    <p className="text-[var(--color-text-primary)] text-sm">{appointment.reason}</p>
                                  </div>
                                )}

                                {appointment.status === 'approved' && (appointment.approvedSlot || appointment.assignedTrainer || appointment.sessionType) && (
                                  <div className="p-3 rounded-lg bg-[var(--color-accent-dim)] border border-[var(--color-accent-border)]">
                                    <p className="text-xs text-[var(--color-accent-val)] mb-2 font-semibold">Detalles de aprobación:</p>
                                    <div className="flex flex-wrap gap-3 text-sm">
                                      {appointment.approvedSlot && (
                                        <span className="text-[var(--color-text-primary)]">
                                          Franja: {new Date(appointment.approvedSlot.date).toLocaleDateString('es-ES', {
                                            weekday: 'short', day: 'numeric', month: 'short',
                                          })} - {appointment.approvedSlot.time}
                                        </span>
                                      )}
                                      {appointment.assignedTrainer && (
                                        <span className="text-[var(--color-text-primary)]">
                                          Entrenador: <strong>{trainers.find(t => t.id === appointment.assignedTrainer)?.name || appointment.assignedTrainer}</strong>
                                        </span>
                                      )}
                                      {appointment.sessionType && (
                                        <span className="px-2 py-0.5 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-xs font-medium uppercase">{appointment.sessionType}</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {appointment.trainerNotes && (
                                  <div className="p-3 rounded-lg bg-[var(--color-accent-dim)] border border-accent/20">
                                    <p className="text-xs text-[var(--color-accent-val)] mb-1 font-semibold flex items-center gap-1">
                                      <FileText className="w-3.5 h-3.5" />
                                      Notas del entrenador:
                                    </p>
                                    <p className="text-[var(--color-text-primary)] text-sm">{appointment.trainerNotes}</p>
                                  </div>
                                )}

                                <p className="text-xs text-[var(--color-text-secondary)]">
                                  Enviado el {new Date(appointment.createdAt).toLocaleDateString('es-ES', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </p>
                              </div>

                              {/* Actions */}
                              <div className="flex flex-row lg:flex-col gap-2 lg:w-40">
                                {appointment.status === 'pending' && (
                                  <>
                                    <PremiumButton
                                      variant="cta"
                                      size="sm"
                                      icon={<Check className="w-4 h-4" />}
                                      onClick={() => {
                                        setSelectedAppointmentId(appointment.id);
                                        setApprovalData({ assignedTrainer: '', sessionType: '' });
                                        setShowApprovalModal(true);
                                      }}
                                      className="flex-1 lg:flex-none"
                                    >
                                      Aprobar
                                    </PremiumButton>
                                    <PremiumButton
                                      variant="outline"
                                      size="sm"
                                      icon={<CalendarClock className="w-4 h-4" />}
                                      onClick={() => {
                                        setSelectedAppointmentId(appointment.id);
                                        setEditSlotData({ date: '', time: '' });
                                        setShowEditSlotModal(true);
                                      }}
                                      className="flex-1 lg:flex-none"
                                    >
                                      Modificar
                                    </PremiumButton>
                                    <PremiumButton
                                      variant="ghost"
                                      size="sm"
                                      icon={<XCircle className="w-4 h-4" />}
                                      onClick={() => handleStatusUpdate(appointment.id, 'rejected')}
                                      className="flex-1 lg:flex-none text-destructive hover:bg-destructive/10"
                                    >
                                      Rechazar
                                    </PremiumButton>
                                  </>
                                )}
                                {appointment.status === 'approved' && (
                                  <>
                                    <PremiumButton
                                      variant="outline"
                                      size="sm"
                                      icon={<RefreshCw className="w-4 h-4" />}
                                      onClick={() => handleStatusUpdate(appointment.id, 'pending')}
                                      className="w-full"
                                    >
                                      Pendiente
                                    </PremiumButton>
                                    <PremiumButton
                                      variant="outline"
                                      size="sm"
                                      icon={<CalendarClock className="w-4 h-4" />}
                                      onClick={() => {
                                        setSelectedAppointmentId(appointment.id);
                                        setEditSlotData({ date: '', time: '' });
                                        setShowEditSlotModal(true);
                                      }}
                                      className="w-full"
                                    >
                                      Modificar
                                    </PremiumButton>
                                  </>
                                )}
                                {appointment.status === 'rejected' && (
                                  <PremiumButton
                                    variant="outline"
                                    size="sm"
                                    icon={<RefreshCw className="w-4 h-4" />}
                                    onClick={() => handleStatusUpdate(appointment.id, 'pending')}
                                    className="w-full"
                                  >
                                    Reactivar
                                  </PremiumButton>
                                )}
                                <PremiumButton
                                  variant="ghost"
                                  size="sm"
                                  icon={<Trash2 className="w-4 h-4" />}
                                  onClick={async () => {
                                    if (confirm('¿Estás seguro de eliminar esta cita?')) {
                                      // Webhook BEFORE delete — data still available
                                      const trainerObj = trainers.find(t => t.id === appointment.assignedTrainer);
                                      await sendWebhook({
                                        action: 'deleted',
                                        customerName: appointment.name,
                                        customerEmail: appointment.email,
                                        date: appointment.approvedSlot?.date || appointment.preferredSlots?.[0]?.date || '',
                                        time: appointment.approvedSlot?.time || appointment.preferredSlots?.[0]?.time || '',
                                        sessionType: appointment.sessionType || '',
                                        trainerName: trainerObj?.name || '',
                                      });
                                      // Decrement slot_occupancy if appointment was approved
                                      if (appointment.status === 'approved') {
                                        const slot = appointment.approvedSlot || appointment.preferredSlots?.[0];
                                        if (slot) await decrementSlotOccupancy(slot.date, slot.time, parseInt(appointment.duration, 10));
                                      }
                                      await deleteAppointmentFS(appointment.id);
                                      await addActivityLog({
                                        action: 'appointment_deleted',
                                        adminEmail: user?.email || 'unknown',
                                        details: `Cita de ${appointment.name} (ID: ${appointment.id})`,
                                      });
                                      await refreshData();
                                    }
                                  }}
                                  className="w-full text-destructive hover:bg-destructive/10"
                                >
                                  Eliminar
                                </PremiumButton>
                              </div>
                            </div>
                          </GlassCard>
                        </motion.div>
                      );
                    })}
                    {filteredAppointments.length === 0 && (
                      <GlassCard className="p-12 text-center">
                        <Calendar className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-secondary)] opacity-50" />
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">No hay citas</h3>
                        <p className="text-[var(--color-text-secondary)]">
                          {statusFilter === 'all'
                            ? 'Aún no se han recibido solicitudes de cita'
                            : `No hay citas ${statusConfig[statusFilter as keyof typeof statusConfig]?.label.toLowerCase()}`}
                        </p>
                      </GlassCard>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ============================================
                  CLIENTS
                  ============================================ */}
              {activeTab === 'clients' && (
                <motion.div
                  key="clients"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Gestión de Clientes</h1>
                    <div className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
                      Total: <span className="text-[var(--color-text-primary)] font-semibold">{clients.length}</span>
                    </div>
                  </div>

                  {/* Search bar */}
                  <div className="relative mb-6">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" />
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="Buscar por nombre o email..."
                      className="w-full pl-11 pr-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] placeholder:text-[var(--color-text-secondary)]"
                    />
                  </div>

                  <div className="grid gap-4">
                    {clients
                      .filter((c) => {
                        if (!clientSearch.trim()) return true;
                        const q = clientSearch.toLowerCase();
                        return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
                      })
                      .map((client) => (
                      <GlassCard key={client.uid} className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            {client.photoURL ? (
                              <img
                                src={client.photoURL}
                                alt={client.name}
                                className="w-12 h-12 rounded-full object-cover ring-2 ring-[var(--color-accent-border)]"
                              />
                            ) : (
                              <div className={cn(
                                "w-12 h-12 rounded-full flex items-center justify-center",
                                client.role === 'admin' ? "bg-[var(--color-accent-dim)]" : client.isTrainer ? "bg-[var(--color-accent-dim)]" : "bg-[var(--color-accent-dim)]"
                              )}>
                                {client.isTrainer ? (
                                  <Dumbbell className="w-6 h-6 text-[var(--color-accent-val)]" />
                                ) : (
                                  <User className="w-6 h-6 text-[var(--color-accent-val)]" />
                                )}
                              </div>
                            )}
                            <div>
                              <h3 className="font-semibold text-[var(--color-text-primary)]">{client.name}</h3>
                              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                                <Mail className="w-3.5 h-3.5" />
                                {client.email}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4" />
                              {client.phone}
                            </div>
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              Unido el {client.createdAt ? new Date(client.createdAt).toLocaleDateString() : 'Fecha desconocida'}
                            </div>
                            {/* Role dropdown */}
                            <select
                              value={client.role}
                              onChange={async (e) => {
                                const newRole = e.target.value as 'admin' | 'trainer' | 'user';
                                const oldRole = client.role;
                                if (newRole === oldRole) return;
                                try {
                                  if (newRole === 'trainer') {
                                    // ENTRENADOR: role → trainer, isTrainer → true, crear trainer doc
                                    await updateUserProfile(client.uid, { role: 'trainer', isTrainer: true });
                                    const existingTrainer = await getTrainerByUid(client.uid);
                                    if (!existingTrainer) {
                                      await addTrainerFS({ uid: client.uid, name: client.name, active: true });
                                    }
                                  } else if (newRole === 'user') {
                                    // CLIENTE: role → user, isTrainer → false, eliminar trainer doc
                                    await updateUserProfile(client.uid, { role: 'user', isTrainer: false });
                                    const trainerDoc = await getTrainerByUid(client.uid);
                                    if (trainerDoc) {
                                      await deleteTrainerFS(trainerDoc.id);
                                    }
                                  } else if (newRole === 'admin') {
                                    // ADMIN: solo cambiar role a admin. NO tocar isTrainer ni trainer doc
                                    await updateUserProfile(client.uid, { role: 'admin' });
                                  }
                                  await refreshData();
                                } catch (err) {
                                  console.error('Error updating role:', err);
                                  alert('Error al cambiar el rol.');
                                }
                              }}
                              className={cn(
                                "px-2 py-1 rounded-lg text-xs font-medium uppercase tracking-tight border bg-input focus:outline-none focus:border-[var(--color-accent-val)] cursor-pointer",
                                client.role === 'admin'
                                  ? "text-[var(--color-accent-val)] border-accent/30"
                                  : client.role === 'trainer'
                                    ? "text-[var(--color-accent-val)] border-[var(--color-accent-border)]"
                                    : "text-[var(--color-text-primary)] border-border"
                              )}
                            >
                              <option value="user">Cliente</option>
                              <option value="trainer">Entrenador</option>
                              <option value="admin">Admin</option>
                            </select>
                          </div>
                        </div>

                        {/* Bono Section */}
                        <div className="mt-4 pt-4 border-t border-white/10">
                          {clientBonos[client.uid] ? (
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="px-2.5 py-1 rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-xs font-medium border border-[var(--color-accent-border)]">
                                  <Ticket className="w-3 h-3 inline mr-1" />
                                  Bono {getBonoMinutosTotales(clientBonos[client.uid]!) / 60}h
                                </span>
                                <span className="text-sm text-[var(--color-text-primary)]">
                                  {formatMinutos(getBonoMinutosRestantes(clientBonos[client.uid]!))} / {formatMinutos(getBonoMinutosTotales(clientBonos[client.uid]!))}
                                </span>
                                <span className="text-xs text-[var(--color-text-secondary)]">
                                  Expira: {new Date(clientBonos[client.uid]!.fechaExpiracion).toLocaleDateString('es-ES')}
                                </span>
                              </div>
                              {/* Progress bar */}
                              <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden max-w-xs">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright transition-all"
                                  style={{ width: `${(getBonoMinutosRestantes(clientBonos[client.uid]!) / getBonoMinutosTotales(clientBonos[client.uid]!)) * 100}%` }}
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={async () => {
                                    const bono = clientBonos[client.uid]!;
                                    if (getBonoMinutosRestantes(bono) < 30) {
                                      alert('Este bono no tiene minutos suficientes para descontar.');
                                      return;
                                    }
                                    if (!window.confirm(`¿Descontar 30 min manualmente del bono de ${client.name}?`)) return;
                                    try {
                                      await manualDeductBonoMinutes(bono.id, 30, user?.email || 'admin');
                                      await addActivityLog({
                                        action: 'bono_manual_deduct',
                                        adminEmail: user?.email || 'unknown',
                                        details: `Cliente: ${client.name}, Bono: ${bono.id}, 30 min`,
                                      });
                                      await refreshData();
                                    } catch (err) {
                                      console.error('Error deducting minutes:', err);
                                      alert('Error al descontar minutos');
                                    }
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors flex items-center gap-1"
                                >
                                  <Minus className="w-3 h-3" /> Descontar 30 min
                                </button>
                                <button
                                  onClick={async () => {
                                    const bono = clientBonos[client.uid]!;
                                    if (!window.confirm(`¿Añadir 30 min al bono de ${client.name}?`)) return;
                                    try {
                                      await addBonoMinutes(bono.id, 30);
                                      await addActivityLog({ action: 'bono_manual_add', adminEmail: user?.email || 'unknown', details: `Cliente: ${client.name}, Bono: ${bono.id}, 30 min` });
                                      await refreshData();
                                    } catch (err) {
                                      console.error('Error adding minutes:', err);
                                      alert('Error al añadir minutos');
                                    }
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] hover:bg-[var(--color-accent-dim)] transition-colors flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" /> Añadir 30 min
                                </button>
                                <button
                                  onClick={() => { setDeleteBonoClient(client); setShowDeleteBonoModal(true); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3" /> Eliminar Bono
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--color-text-secondary)] mb-2">Sin bono activo</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setAssignBonoClient(client);
                                setAssignBonoTamano(240);
                                setShowAssignBonoModal(true);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] hover:bg-[var(--color-accent-dim)] transition-colors flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Asignar Bono
                            </button>
                            <button
                              onClick={async () => {
                                const [bonos, appts] = await Promise.all([
                                  getBonosByUser(client.uid),
                                  getAppointmentsByUser(client.uid),
                                ]);
                                setBonoHistoryData(bonos);
                                setClientAppointmentsHistory(
                                  appts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                );
                                setBonoHistoryClientName(client.name);
                                setShowBonoHistoryModal(true);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/20 text-[var(--color-text-secondary)] border border-white/10 hover:text-[var(--color-text-primary)] hover:border-white/20 transition-colors flex items-center gap-1"
                            >
                              <History className="w-3 h-3" /> Historial
                            </button>
                          </div>
                        </div>
                      </GlassCard>
                    ))}
                    {clients.length === 0 && (
                      <GlassCard className="p-12 text-center">
                        <Users className="w-12 h-12 mx-auto mb-4 text-[var(--color-text-secondary)] opacity-30" />
                        <p className="text-[var(--color-text-secondary)]">No hay clientes registrados.</p>
                      </GlassCard>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ============================================
                  TEAM (Equipo)
                  ============================================ */}
              {activeTab === 'team' && (
                <motion.div
                  key="team"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Equipo de Entrenadores</h1>
                    <div className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
                      Total: <span className="text-[var(--color-text-primary)] font-semibold">{trainers.length}</span>
                    </div>
                  </div>

                  {/* Admin self-toggle: añadirse/quitarse como entrenadora */}
                  {isAdmin && userProfile && (
                    <GlassCard className="p-4 mb-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[var(--color-accent-dim)] flex items-center justify-center">
                            <Award className="w-5 h-5 text-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">{userProfile.name}</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">Administradora</p>
                          </div>
                        </div>
                        {userProfile.isTrainer ? (
                          <PremiumButton
                            variant="ghost"
                            size="sm"
                            icon={<X className="w-4 h-4" />}
                            onClick={async () => {
                              if (confirm('¿Quitarte del equipo de entrenadores?')) {
                                try {
                                  await updateUserProfile(userProfile.uid, { isTrainer: false });
                                  const trainerDoc = await getTrainerByUid(userProfile.uid);
                                  if (trainerDoc) {
                                    await deleteTrainerFS(trainerDoc.id);
                                  }
                                  await refreshData();
                                  await refreshUserProfile();
                                } catch (err) {
                                  console.error('Error:', err);
                                  alert('Error al actualizar.');
                                }
                              }
                            }}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            Quitarme del equipo
                          </PremiumButton>
                        ) : (
                          <PremiumButton
                            variant="cta"
                            size="sm"
                            icon={<Dumbbell className="w-4 h-4" />}
                            onClick={async () => {
                              try {
                                await updateUserProfile(userProfile.uid, { isTrainer: true });
                                const existingTrainer = await getTrainerByUid(userProfile.uid);
                                if (!existingTrainer) {
                                  await addTrainerFS({ uid: userProfile.uid, name: userProfile.name, active: true });
                                }
                                await refreshData();
                                await refreshUserProfile();
                              } catch (err) {
                                console.error('Error:', err);
                                alert('Error al actualizar.');
                              }
                            }}
                          >
                            Añadirme como entrenadora
                          </PremiumButton>
                        )}
                      </div>
                    </GlassCard>
                  )}

                  <div className="grid gap-4">
                    {trainers.map((trainer) => (
                      <GlassCard key={trainer.id} className="p-6">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-[var(--color-accent-dim)] flex items-center justify-center">
                              <Dumbbell className="w-6 h-6 text-[var(--color-accent-val)]" />
                            </div>
                            <h3 className="font-semibold text-[var(--color-text-primary)]">{trainer.name}</h3>
                          </div>
                          <PremiumButton
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 className="w-4 h-4" />}
                            onClick={async () => {
                              if (confirm(`¿Eliminar a ${trainer.name} del equipo?`)) {
                                try {
                                  // Obtener el perfil del usuario para evaluar su rol
                                  const trainerUser = await getUserProfile(trainer.uid);
                                  
                                  if (trainerUser?.role === 'admin') {
                                    // Admin: solo quitar isTrainer, mantener role admin
                                    await updateUserProfile(trainer.uid, { isTrainer: false });
                                  } else {
                                    // Trainer u otro: quitar isTrainer + degradar a user
                                    await updateUserProfile(trainer.uid, { isTrainer: false, role: 'user' });
                                  }
                                  
                                  // Eliminar el doc de la colección trainers
                                  await deleteTrainerFS(trainer.id);
                                  await refreshData();
                                } catch (err) {
                                  console.error('Error removing trainer:', err);
                                  alert('Error al eliminar del equipo.');
                                }
                              }
                            }}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            Eliminar
                          </PremiumButton>
                        </div>
                      </GlassCard>
                    ))}
                    {trainers.length === 0 && (
                      <GlassCard className="p-12 text-center">
                        <Dumbbell className="w-12 h-12 mx-auto mb-4 text-[var(--color-text-secondary)] opacity-30" />
                        <p className="text-[var(--color-text-secondary)] mb-2">No hay entrenadores registrados.</p>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          Ve a la pestaña <button onClick={() => setActiveTab('clients')} className="text-[var(--color-accent-val)] underline">Clientes</button> y cambia el rol de un usuario a &ldquo;Entrenador&rdquo;.
                        </p>
                      </GlassCard>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ============================================
                  TESTIMONIALS
                  ============================================ */}
              {activeTab === 'testimonials' && (
                <motion.div
                  key="testimonials"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Gestión de Testimonios</h1>
                    <PremiumButton
                      variant="cta"
                      icon={<Plus className="w-4 h-4" />}
                      onClick={() => setEditingTestimonial({
                        id: `new-${Date.now()}`,
                        name: '',
                        role: '',
                        content: '',
                        rating: 5,
                        approved: false,
                      })}
                    >
                      Nuevo Testimonio
                    </PremiumButton>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {testimonials.map((testimonial) => (
                      <GlassCard key={testimonial.id} className="p-6">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-[var(--color-text-primary)]">{testimonial.name}</h3>
                            <p className="text-xs text-[var(--color-text-secondary)]">{testimonial.role}</p>
                          </div>
                          <span className={cn(
                            'px-2 py-1 text-xs rounded',
                            testimonial.approved ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]' : 'bg-yellow-500/20 text-yellow-400'
                          )}>
                            {testimonial.approved ? 'Aprobado' : 'Pendiente'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mb-3">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={cn('w-4 h-4', i < testimonial.rating ? 'text-[var(--color-accent-val)] fill-accent' : 'text-[var(--color-text-secondary)]')}
                            />
                          ))}
                        </div>
                        <p className="text-sm text-[var(--color-text-secondary)] italic mb-4">"{testimonial.content}"</p>
                        <div className="flex gap-2">
                          {!testimonial.approved && (
                            <PremiumButton
                              variant="outline"
                              size="sm"
                              icon={<Check className="w-3 h-3" />}
                              onClick={async () => { await approveTestimonialFS(testimonial.id); await refreshData(); }}
                            >
                              Aprobar
                            </PremiumButton>
                          )}
                          <PremiumButton
                            variant="ghost"
                            size="sm"
                            icon={<Edit3 className="w-3 h-3" />}
                            onClick={() => setEditingTestimonial(testimonial)}
                          />
                          <PremiumButton
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 className="w-3 h-3" />}
                            onClick={async () => {
                              if (confirm('¿Eliminar este testimonio?')) {
                                await deleteTestimonialFS(testimonial.id);
                                await refreshData();
                              }
                            }}
                            className="text-destructive"
                          />
                        </div>
                      </GlassCard>
                    ))}
                  </div>
                </motion.div>
              )}


              {/* ============================================
                  CMS - SANDRA
                  ============================================ */}

              {/* MediaPicker Sandra foto */}
              {sandraPickerOpen && (
                <MediaPicker
                  open={sandraPickerOpen}
                  onClose={() => setSandraPickerOpen(false)}
                  onSelect={async (file) => {
                    setEditedContent((prev) =>
                      prev?.sandra
                        ? { ...prev, sandra: { ...prev.sandra, image: file.url } } as CMSContent
                        : prev
                    );
                    setSandraPickerOpen(false);
                  }}
                  filterType="image"
                />
              )}

              {activeTab === 'Sandra' && (
                <motion.div
                  key="Sandra"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Sandra Andújar</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveSandra}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">
                    {/* === INFORMACIÓN BÁSICA === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">Información Básica</h2>

                      {/* Foto */}
                      <div className="mb-6">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Foto de Perfil</label>
                        <div className="flex items-center gap-4 mb-3">
                          <div className="w-24 h-24 rounded-2xl overflow-hidden border border-border flex-shrink-0">
                            {editedContent?.sandra?.image ? (
                              <img src={editedContent.sandra.image} alt="Sandra" className="w-full h-full object-cover object-top" />
                            ) : (
                              <div className="w-full h-full bg-muted/30 flex items-center justify-center">
                                <ImageIcon className="w-8 h-8 text-[var(--color-text-secondary)] opacity-50" />
                              </div>
                            )}
                          </div>
                          <PremiumButton
                            variant="outline"
                            size="sm"
                            icon={<ImageIcon className="w-4 h-4" />}
                            onClick={() => setSandraPickerOpen(true)}
                          >
                            Cambiar Foto
                          </PremiumButton>
                        </div>
                      </div>

                      {/* Eyebrow */}
                      <div className="mb-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow (texto sobre el nombre)</label>
                        <input
                          type="text"
                          value={editedContent?.sandra?.eyebrow ?? ''}
                          onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, eyebrow: e.target.value } } as CMSContent : prev)}
                          placeholder="La experta detrás del proyecto"
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                        />
                      </div>

                      {/* Nombre */}
                      <div className="mb-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Nombre</label>
                        <input
                          type="text"
                          value={editedContent?.sandra?.name ?? ''}
                          onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, name: e.target.value } } as CMSContent : prev)}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                        />
                      </div>

                      {/* Biografía */}
                      <div>
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Biografía</label>
                        <textarea
                          value={editedContent?.sandra?.bio ?? ''}
                          onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, bio: e.target.value } } as CMSContent : prev)}
                          rows={5}
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                        />
                      </div>
                    </GlassCard>

                    {/* === LOGROS === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">Logros Destacados</h2>
                      <div className="space-y-2">
                        {(editedContent?.sandra?.achievements ?? []).map((a, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <IconPicker
                              value={a.icon || 'Award'}
                              onChange={(icon) => {
                                const arr = [...(editedContent?.sandra?.achievements ?? [])];
                                arr[i] = { ...arr[i], icon };
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, achievements: arr } } as CMSContent : prev);
                              }}
                            />
                            <input
                              type="text"
                              value={a.title ?? ''}
                              onChange={(e) => {
                                const arr = [...(editedContent?.sandra?.achievements ?? [])];
                                arr[i] = { ...arr[i], title: e.target.value };
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, achievements: arr } } as CMSContent : prev);
                              }}
                              placeholder="Título"
                              className="w-36 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
                            />
                            <input
                              type="text"
                              value={a.description ?? ''}
                              onChange={(e) => {
                                const arr = [...(editedContent?.sandra?.achievements ?? [])];
                                arr[i] = { ...arr[i], description: e.target.value };
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, achievements: arr } } as CMSContent : prev);
                              }}
                              placeholder="Descripción breve"
                              className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const arr = (editedContent?.sandra?.achievements ?? []).filter((_, j) => j !== i);
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, achievements: arr } } as CMSContent : prev);
                              }}
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-xl flex-shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3">
                        <PremiumButton
                          variant="outline"
                          size="sm"
                          icon={<Plus className="w-4 h-4" />}
                          onClick={() => {
                            const arr = [...(editedContent?.sandra?.achievements ?? []), { icon: 'Award', title: '', description: '' }];
                            setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, achievements: arr } } as CMSContent : prev);
                          }}
                        >
                          Añadir logro
                        </PremiumButton>
                      </div>
                    </GlassCard>

                    {/* === VALORES === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Valores</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow de sección</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.valuesEyebrow ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, valuesEyebrow: e.target.value } } as CMSContent : prev)}
                            placeholder="Filosofía de trabajo"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título de sección</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.valuesTitle ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, valuesTitle: e.target.value } } as CMSContent : prev)}
                            placeholder="Valores que nos definen"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        {(editedContent?.sandra?.values ?? []).map((v, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <IconPicker
                              value={v.icon || 'Heart'}
                              onChange={(icon) => {
                                const arr = [...(editedContent?.sandra?.values ?? [])];
                                arr[i] = { ...arr[i], icon };
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, values: arr } } as CMSContent : prev);
                              }}
                            />
                            <input
                              type="text"
                              value={v.title ?? ''}
                              onChange={(e) => {
                                const arr = [...(editedContent?.sandra?.values ?? [])];
                                arr[i] = { ...arr[i], title: e.target.value };
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, values: arr } } as CMSContent : prev);
                              }}
                              placeholder="Título"
                              className="w-36 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
                            />
                            <input
                              type="text"
                              value={v.description ?? ''}
                              onChange={(e) => {
                                const arr = [...(editedContent?.sandra?.values ?? [])];
                                arr[i] = { ...arr[i], description: e.target.value };
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, values: arr } } as CMSContent : prev);
                              }}
                              placeholder="Descripción"
                              className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const arr = (editedContent?.sandra?.values ?? []).filter((_, j) => j !== i);
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, values: arr } } as CMSContent : prev);
                              }}
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-xl flex-shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3">
                        <PremiumButton
                          variant="outline"
                          size="sm"
                          icon={<Plus className="w-4 h-4" />}
                          onClick={() => {
                            const arr = [...(editedContent?.sandra?.values ?? []), { icon: 'Heart', title: '', description: '' }];
                            setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, values: arr } } as CMSContent : prev);
                          }}
                        >
                          Añadir valor
                        </PremiumButton>
                      </div>
                    </GlassCard>

                    {/* === TIMELINE === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Timeline Profesional</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow de sección</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.timelineEyebrow ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, timelineEyebrow: e.target.value } } as CMSContent : prev)}
                            placeholder="Trayectoria profesional"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título de sección</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.timelineTitle ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, timelineTitle: e.target.value } } as CMSContent : prev)}
                            placeholder="Un camino de dedicación"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                      </div>
                      <DndContext
                        collisionDetection={closestCenter}
                        onDragEnd={(event: DragEndEvent) => {
                          const { active, over } = event;
                          if (active.id !== over?.id) {
                            const oldIndex = Number(active.id);
                            const newIndex = Number(over!.id);
                            const newTimeline = arrayMove(editedContent!.sandra!.timeline, oldIndex, newIndex);
                            setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, timeline: newTimeline } } as CMSContent : prev);
                          }
                        }}
                      >
                        <SortableContext
                          items={(editedContent?.sandra?.timeline ?? []).map((_, i) => i.toString())}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-3 mb-3">
                            {(editedContent?.sandra?.timeline ?? []).map((item, i) => (
                              <SortableTimelineItem
                                key={i}
                                item={item}
                                index={i}
                                onUpdate={(field, val) => {
                                  const arr = [...(editedContent?.sandra?.timeline ?? [])];
                                  arr[i] = { ...arr[i], [field]: val };
                                  setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, timeline: arr } } as CMSContent : prev);
                                }}
                                onRemove={() => {
                                  const arr = (editedContent?.sandra?.timeline ?? []).filter((_, j) => j !== i);
                                  setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, timeline: arr } } as CMSContent : prev);
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      <PremiumButton
                        variant="outline"
                        size="sm"
                        icon={<Plus className="w-4 h-4" />}
                        onClick={() => {
                          const arr = [...(editedContent?.sandra?.timeline ?? []), { year: '', title: '', description: '' }];
                          setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, timeline: arr } } as CMSContent : prev);
                        }}
                      >
                        Añadir hito
                      </PremiumButton>
                    </GlassCard>

                    {/* === CERTIFICACIONES === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Certificaciones</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow de sección</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.certsEyebrow ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, certsEyebrow: e.target.value } } as CMSContent : prev)}
                            placeholder="Formación académica"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título de sección</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.certsTitle ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, certsTitle: e.target.value } } as CMSContent : prev)}
                            placeholder="Certificaciones y títulos"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtítulo de sección</label>
                        <input
                          type="text"
                          value={editedContent?.sandra?.certsSubtitle ?? ''}
                          onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, certsSubtitle: e.target.value } } as CMSContent : prev)}
                          placeholder="Una formación continua y rigurosa..."
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                        />
                      </div>
                      <div className="space-y-2">
                        {(editedContent?.sandra?.certifications ?? []).map((cert, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="text"
                              value={cert}
                              onChange={(e) => {
                                const arr = [...(editedContent?.sandra?.certifications ?? [])];
                                arr[i] = e.target.value;
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, certifications: arr } } as CMSContent : prev);
                              }}
                              className="flex-1 px-4 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const arr = (editedContent?.sandra?.certifications ?? []).filter((_, j) => j !== i);
                                setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, certifications: arr } } as CMSContent : prev);
                              }}
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-xl"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3">
                        <PremiumButton
                          variant="outline"
                          size="sm"
                          icon={<Plus className="w-4 h-4" />}
                          onClick={() => {
                            const arr = [...(editedContent?.sandra?.certifications ?? []), ''];
                            setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, certifications: arr } } as CMSContent : prev);
                          }}
                        >
                          Añadir certificación
                        </PremiumButton>
                      </div>
                    </GlassCard>

                    {/* === CTA === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">CTA Final</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título</label>
                          <input
                            type="text"
                            value={editedContent?.sandra?.ctaTitle ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, ctaTitle: e.target.value } } as CMSContent : prev)}
                            placeholder="¿Listo para empezar?"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Descripción</label>
                          <textarea
                            value={editedContent?.sandra?.ctaDescription ?? ''}
                            onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, ctaDescription: e.target.value } } as CMSContent : prev)}
                            rows={2}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                          />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto del botón</label>
                            <input
                              type="text"
                              value={editedContent?.sandra?.ctaButtonText ?? ''}
                              onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, ctaButtonText: e.target.value } } as CMSContent : prev)}
                              placeholder="Reservar Cita"
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Enlace del botón</label>
                            <input
                              type="text"
                              value={editedContent?.sandra?.ctaButtonLink ?? ''}
                              onChange={(e) => setEditedContent((prev) => prev?.sandra ? { ...prev, sandra: { ...prev.sandra, ctaButtonLink: e.target.value } } as CMSContent : prev)}
                              placeholder="/portal"
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}

              {/* ============================================
                  CMS - CENTRO
                  ============================================ */}
              {activeTab === 'Centro' && (
                <motion.div
                  key="Centro"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Editar El Centro</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveCentro}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Header</h2>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.centro?.eyebrow ?? ''} onChange={(e) => updateCentroField('eyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.centro?.title ?? ''} onChange={(e) => updateCentroField('title', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                        <input type="text" value={editedContent?.centro?.subtitle ?? ''} onChange={(e) => updateCentroField('subtitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                      </div>
                      <div className="mt-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Descripcion principal</label>
                        <textarea value={editedContent?.centro?.description ?? ''} onChange={(e) => updateCentroField('description', e.target.value)} rows={4} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                      </div>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Nuestras Zonas</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo de seccion</label>
                          <input type="text" value={editedContent?.centro?.zonasTitle ?? ''} onChange={(e) => updateCentroField('zonasTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo de seccion</label>
                          <input type="text" value={editedContent?.centro?.zonasSubtitle ?? ''} onChange={(e) => updateCentroField('zonasSubtitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleCentroZonasDragEnd}>
                        <SortableContext items={(editedContent?.centro?.zonas ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          <div className="space-y-3">
                            {(editedContent?.centro?.zonas ?? []).map((zona, index) => (
                              <SortableCentroZonaItem
                                key={index}
                                zona={zona}
                                index={index}
                                onUpdate={(field, value) => updateCentroZonaField(index, field, value)}
                                onRemove={() => removeCentroZona(index)}
                                onToggleActive={() => toggleCentroZonaActive(index)}
                                onPickImage={() => {
                                  setCentroPickerIndex(index);
                                  setCentroPickerOpen(true);
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addCentroZona} className="mt-4">
                        Anadir zona
                      </PremiumButton>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Por que elegirnos?</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo de seccion</label>
                          <input type="text" value={editedContent?.centro?.featuresTitle ?? ''} onChange={(e) => updateCentroField('featuresTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo de seccion</label>
                          <input type="text" value={editedContent?.centro?.featuresSubtitle ?? ''} onChange={(e) => updateCentroField('featuresSubtitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div className="space-y-3">
                        {(editedContent?.centro?.features ?? []).map((feature, index) => (
                          <div key={index} className="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
                            <div className="grid sm:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Icono</label>
                                <IconPicker
                                  value={feature.icon ?? 'Sparkles'}
                                  onChange={(icon) => {
                                    const features = [...(editedContent?.centro?.features ?? [])];
                                    features[index] = { ...features[index], icon };
                                    updateCentroField('features', features);
                                  }}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Titulo</label>
                                <input type="text" value={feature.title ?? ''} onChange={(e) => {
                                  const features = [...(editedContent?.centro?.features ?? [])];
                                  features[index] = { ...features[index], title: e.target.value };
                                  updateCentroField('features', features);
                                }} className="w-full px-3 py-2 rounded-lg bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                              </div>
                              <div className="flex items-end justify-end">
                                <button type="button" onClick={() => {
                                  const features = (editedContent?.centro?.features ?? []).filter((_, i) => i !== index);
                                  updateCentroField('features', features);
                                }} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <textarea value={feature.description ?? ''} onChange={(e) => {
                              const features = [...(editedContent?.centro?.features ?? [])];
                              features[index] = { ...features[index], description: e.target.value };
                              updateCentroField('features', features);
                            }} rows={2} className="w-full px-3 py-2 rounded-lg bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                          </div>
                        ))}
                      </div>
                      <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => {
                        const features = [...(editedContent?.centro?.features ?? []), { icon: 'Sparkles', title: '', description: '' }];
                        updateCentroField('features', features);
                      }} className="mt-4">
                        Anadir feature
                      </PremiumButton>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Como llegar</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.centro?.locationEyebrow ?? ''} onChange={(e) => updateCentroField('locationEyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.centro?.locationTitle ?? ''} onChange={(e) => updateCentroField('locationTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Direccion</label>
                          <input type="text" value={editedContent?.centro?.address ?? ''} onChange={(e) => updateCentroField('address', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Horario</label>
                          <input type="text" value={editedContent?.centro?.schedule ?? ''} onChange={(e) => updateCentroField('schedule', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Telefono</label>
                          <input type="text" value={editedContent?.centro?.phone ?? ''} onChange={(e) => updateCentroField('phone', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Email</label>
                          <input type="text" value={editedContent?.centro?.email ?? ''} onChange={(e) => updateCentroField('email', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto CTA</label>
                          <input type="text" value={editedContent?.centro?.ctaText ?? ''} onChange={(e) => updateCentroField('ctaText', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Enlace CTA</label>
                          <input type="text" value={editedContent?.centro?.ctaLink ?? ''} onChange={(e) => updateCentroField('ctaLink', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Map URL (iframe src)</label>
                        <textarea value={editedContent?.centro?.mapUrl ?? ''} onChange={(e) => updateCentroField('mapUrl', e.target.value)} rows={3} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}
              {/* ============================================
                  CMS - SERVICIOS
                  ============================================ */}
              {activeTab === 'Servicios' && (
                <motion.div
                  key="Servicios"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Servicios</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveServicios}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">

                    {/* === HEADER DE LA SECCIÓN === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Header de la sección</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input
                            type="text"
                            value={editedContent?.servicesEyebrow ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, servicesEyebrow: e.target.value } as CMSContent : prev)}
                            placeholder="NUESTROS SERVICIOS"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título</label>
                          <input
                            type="text"
                            value={editedContent?.servicesTitle ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, servicesTitle: e.target.value } as CMSContent : prev)}
                            placeholder="Servicios Especializados"
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtítulo / descripción</label>
                          <input
                            type="text"
                            value={editedContent?.servicesSubtitle ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, servicesSubtitle: e.target.value } as CMSContent : prev)}
                            placeholder="Programas diseñados para atletas..."
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          />
                        </div>
                      </div>
                    </GlassCard>

                    {/* === SERVICIOS === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Servicios</h2>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleServiceDragEnd}>
                        <SortableContext items={editedServices.map(s => s.id)} strategy={verticalListSortingStrategy}>
                          {editedServices.map((service) => (
                            <SortableServiceItem
                              key={service.id}
                              service={service}
                              expanded={expandedServiceId === service.id}
                              onToggle={() => setExpandedServiceId(prev => prev === service.id ? null : service.id)}
                              onUpdate={(field, value) => updateServiceField(service.id, field as keyof Service, value)}
                              onRemove={() => removeEditedService(service.id)}
                              onUpdateFeature={(i, val) => updateServiceFeature(service.id, i, val)}
                              onRemoveFeature={(i) => removeServiceFeature(service.id, i)}
                              onAddFeature={() => addServiceFeature(service.id)}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                      <div className="mt-3">
                        <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addNewService}>
                          Añadir servicio
                        </PremiumButton>
                      </div>
                    </GlassCard>

                    {/* === FAQs === */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Preguntas Frecuentes (FAQs)</h2>
                      <div className="mb-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título de la sección</label>
                        <input
                          type="text"
                          value={editedContent?.servicesFaqsTitle ?? ''}
                          onChange={(e) => setEditedContent(prev => prev ? { ...prev, servicesFaqsTitle: e.target.value } as CMSContent : prev)}
                          placeholder="Preguntas Frecuentes"
                          className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                        />
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleFaqDragEnd}>
                        <SortableContext items={(editedContent?.servicesFaqs ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          {(editedContent?.servicesFaqs ?? []).map((faq, i) => (
                            <SortableFaqItem
                              key={i}
                              faq={faq}
                              index={i}
                              onUpdate={(field, val) => updateFaq(i, field, val)}
                              onRemove={() => removeFaq(i)}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                      <div className="mt-3">
                        <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addFaq}>
                          Añadir pregunta
                        </PremiumButton>
                      </div>
                    </GlassCard>

                  </div>
                </motion.div>
              )}

              {/* ============================================
                  CMS - GALERÍA
                  ============================================ */}
              {activeTab === 'Galeria' && (
                <motion.div
                  key="Galeria"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">CMS Galeria</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveGaleria}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">
                    <GalleryManager />

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Header</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.galeria?.heroEyebrow ?? ''} onChange={(e) => updateGaleriaField('heroEyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.galeria?.heroTitle ?? ''} onChange={(e) => updateGaleriaField('heroTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                          <input type="text" value={editedContent?.galeria?.heroSubtitle ?? ''} onChange={(e) => updateGaleriaField('heroSubtitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Stats</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo de seccion</label>
                          <input type="text" value={editedContent?.galeria?.statsTitle ?? ''} onChange={(e) => updateGaleriaField('statsTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo de seccion</label>
                          <input type="text" value={editedContent?.galeria?.statsSubtitle ?? ''} onChange={(e) => updateGaleriaField('statsSubtitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleGaleriaStatsDragEnd}>
                        <SortableContext items={(editedContent?.galeria?.stats ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          <div className="space-y-3">
                            {(editedContent?.galeria?.stats ?? []).map((stat, index) => (
                              <SortableGaleriaStatItem key={index} stat={stat} index={index} onUpdate={(field, value) => updateGaleriaStatField(index, field, value)} onRemove={() => removeGaleriaStat(index)} />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addGaleriaStat} className="mt-4">
                        Anadir stat
                      </PremiumButton>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Entrenamientos</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.galeria?.trainingEyebrow ?? ''} onChange={(e) => updateGaleriaField('trainingEyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.galeria?.trainingTitle ?? ''} onChange={(e) => updateGaleriaField('trainingTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                        <textarea value={editedContent?.galeria?.trainingSubtitle ?? ''} onChange={(e) => updateGaleriaField('trainingSubtitle', e.target.value)} rows={2} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleGaleriaTrainingsDragEnd}>
                        <SortableContext items={(editedContent?.galeria?.trainings ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          <div className="space-y-3">
                            {(editedContent?.galeria?.trainings ?? []).map((training, index) => (
                              <SortableGaleriaTrainingItem
                                key={index}
                                training={training}
                                index={index}
                                onUpdate={(field, value) => updateGaleriaTrainingField(index, field, value)}
                                onRemove={() => removeGaleriaTraining(index)}
                                onToggleActive={() => toggleGaleriaTrainingActive(index)}
                                onPickMedia={() => {
                                  setGaleriaTrainingPickerIndex(index);
                                  setGaleriaTrainingPickerOpen(true);
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addGaleriaTraining} className="mt-4">
                        Anadir entrenamiento
                      </PremiumButton>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Resultados</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.galeria?.resultsEyebrow ?? ''} onChange={(e) => updateGaleriaField('resultsEyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.galeria?.resultsTitle ?? ''} onChange={(e) => updateGaleriaField('resultsTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                        <textarea value={editedContent?.galeria?.resultsSubtitle ?? ''} onChange={(e) => updateGaleriaField('resultsSubtitle', e.target.value)} rows={2} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleGaleriaResultadosDragEnd}>
                        <SortableContext items={(editedContent?.galeria?.resultados ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          <div className="space-y-3">
                            {(editedContent?.galeria?.resultados ?? []).map((resultado, index) => (
                              <SortableGaleriaResultadoItem key={index} resultado={resultado} index={index} onUpdate={(field, value) => updateGaleriaResultadoField(index, field, value)} onRemove={() => removeGaleriaResultado(index)} onToggleActive={() => toggleGaleriaResultadoActive(index)} />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      <PremiumButton variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addGaleriaResultado} className="mt-4">
                        Anadir resultado
                      </PremiumButton>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Seccion Galeria</h2>
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.galeria?.galleryEyebrow ?? ''} onChange={(e) => updateGaleriaField('galleryEyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.galeria?.galleryTitle ?? ''} onChange={(e) => updateGaleriaField('galleryTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                        <textarea value={editedContent?.galeria?.gallerySubtitle ?? ''} onChange={(e) => updateGaleriaField('gallerySubtitle', e.target.value)} rows={2} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}
{/* ============================================
                  CMS - CONTACTO & HERO
                  ============================================ */}
              {activeTab === 'Hero' && (
                <motion.div
                  key="Hero"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Hero</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveCMS}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6 flex items-center gap-2">
                        <ImageIcon className="w-5 h-5 text-[var(--color-accent-val)]" />
                        Sección Hero
                      </h2>
                      <div className="space-y-5">
                        {/* Eyebrow */}
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow (texto sobre el título)</label>
                          <input
                            type="text"
                            value={editedContent?.heroEyebrow ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroEyebrow: e.target.value } as CMSContent : prev)}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            placeholder="Bienvenido a Focus Club Vallecas"
                          />
                        </div>

                        {/* Split title */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título (parte normal)</label>
                            <input
                              type="text"
                              value={editedContent?.heroTitleStart ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroTitleStart: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="Transforma Tu"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Título (parte destacada)</label>
                            <input
                              type="text"
                              value={editedContent?.heroTitleHighlight ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroTitleHighlight: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="Cuerpo y Mente"
                            />
                          </div>
                        </div>

                        {/* Subtítulo */}
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtítulo</label>
                          <textarea
                            value={editedContent?.heroSubtitle || ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroSubtitle: e.target.value } as CMSContent : prev)}
                            rows={3}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Tipo de fondo</label>
                            <select
                              value={editedContent?.heroBackgroundType ?? 'video'}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroBackgroundType: e.target.value === 'image' ? 'image' : 'video' } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            >
                              <option value="video">Video</option>
                              <option value="image">Imagen</option>
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">URL fondo hero</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editedContent?.heroBackgroundUrl ?? ''}
                                onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroBackgroundUrl: e.target.value } as CMSContent : prev)}
                                className="flex-1 px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                                placeholder="https://... o /imagenes/hero.mp4"
                              />
                              <PremiumButton variant="outline" size="sm" onClick={() => setHeroBackgroundPickerOpen(true)}>
                                Elegir
                              </PremiumButton>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">CTA Principal (texto)</label>
                            <input
                              type="text"
                              value={editedContent?.heroCTA || ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroCTA: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="Solicitar Cita"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">CTA Principal (enlace)</label>
                            <input
                              type="text"
                              value={editedContent?.heroCtaPrimaryLink ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroCtaPrimaryLink: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="/portal"
                            />
                          </div>
                        </div>

                        {/* CTA Secundario */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">CTA Secundario (texto)</label>
                            <input
                              type="text"
                              value={editedContent?.heroCtaSecondaryText ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroCtaSecondaryText: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="Ver Servicios"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">CTA Secundario (enlace)</label>
                            <input
                              type="text"
                              value={editedContent?.heroCtaSecondaryLink ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, heroCtaSecondaryLink: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="/servicios"
                            />
                          </div>
                        </div>

                        {/* Stats */}
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-3">Estadísticas</label>
                          <div className="space-y-2">
                            {(editedContent?.heroStats ?? DEFAULT_HERO_STATS).map((stat, i) => (
                              <div key={i} className="flex items-center gap-3">
                                <IconPicker
                                  value={stat.icon}
                                  onChange={(icon) => {
                                    const stats = [...(editedContent?.heroStats ?? DEFAULT_HERO_STATS)];
                                    stats[i] = { ...stats[i], icon };
                                    setEditedContent(prev => prev ? { ...prev, heroStats: stats } as CMSContent : prev);
                                  }}
                                />
                                <input
                                  type="text"
                                  value={stat.value}
                                  onChange={(e) => {
                                    const stats = [...(editedContent?.heroStats ?? DEFAULT_HERO_STATS)];
                                    stats[i] = { ...stats[i], value: e.target.value };
                                    setEditedContent(prev => prev ? { ...prev, heroStats: stats } as CMSContent : prev);
                                  }}
                                  className="w-20 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
                                  placeholder="15+"
                                />
                                <input
                                  type="text"
                                  value={stat.label}
                                  onChange={(e) => {
                                    const stats = [...(editedContent?.heroStats ?? DEFAULT_HERO_STATS)];
                                    stats[i] = { ...stats[i], label: e.target.value };
                                    setEditedContent(prev => prev ? { ...prev, heroStats: stats } as CMSContent : prev);
                                  }}
                                  className="flex-1 px-3 py-2 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] text-sm"
                                  placeholder="Años de Experiencia"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Bloque About (Home)</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.aboutEyebrow ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutEyebrow: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                            <input type="text" value={editedContent?.aboutTitle ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutTitle: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Imagen</label>
                            <div className="flex items-center gap-3 rounded-xl border border-border bg-input/40 p-3">
                              {isValidImageUrl(editedContent?.aboutImage) ? (
                                <img
                                  src={editedContent!.aboutImage}
                                  alt="Preview About Home"
                                  className="h-14 w-14 rounded-lg object-cover border border-border shrink-0"
                                />
                              ) : (
                                <div className="h-14 w-14 rounded-lg border border-border bg-muted/30 flex items-center justify-center shrink-0">
                                  <ImageIcon className="w-5 h-5 text-[var(--color-text-secondary)] opacity-50" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-[var(--color-text-primary)] truncate">
                                  {editedContent?.aboutImage ? 'Imagen seleccionada' : 'Ninguna imagen seleccionada'}
                                </p>
                                <p className="text-xs text-[var(--color-text-secondary)] truncate">
                                  {editedContent?.aboutImage ?? 'Selecciona una imagen desde la biblioteca de medios'}
                                </p>
                              </div>
                              <PremiumButton variant="outline" size="sm" onClick={() => setAboutHomePickerOpen(true)}>
                                Elegir
                              </PremiumButton>
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto</label>
                          <textarea value={editedContent?.aboutText ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutText: e.target.value } as CMSContent : prev)} rows={3} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Badge 1 icono</label>
                            <IconPicker value={editedContent?.aboutBadgeOneIcon ?? 'Award'} onChange={(icon) => setEditedContent(prev => prev ? { ...prev, aboutBadgeOneIcon: icon } as CMSContent : prev)} />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Badge 1 texto</label>
                            <input type="text" value={editedContent?.aboutBadgeOneText ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutBadgeOneText: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Badge 2 icono</label>
                            <IconPicker value={editedContent?.aboutBadgeTwoIcon ?? 'Heart'} onChange={(icon) => setEditedContent(prev => prev ? { ...prev, aboutBadgeTwoIcon: icon } as CMSContent : prev)} />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Badge 2 texto</label>
                            <input type="text" value={editedContent?.aboutBadgeTwoText ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutBadgeTwoText: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto boton</label>
                            <input type="text" value={editedContent?.aboutButtonText ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutButtonText: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Enlace boton</label>
                            <input type="text" value={editedContent?.aboutButtonLink ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutButtonLink: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Nombre tarjeta</label>
                            <input type="text" value={editedContent?.aboutCardName ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutCardName: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Cargo tarjeta</label>
                            <input type="text" value={editedContent?.aboutCardRole ?? ''} onChange={(e) => setEditedContent(prev => prev ? { ...prev, aboutCardRole: e.target.value } as CMSContent : prev)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Testimonios (Home)</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input
                            type="text"
                            value={editedContent?.testimonialsEyebrow ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, testimonialsEyebrow: e.target.value } as CMSContent : prev)}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            placeholder="TESTIMONIOS"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input
                            type="text"
                            value={editedContent?.testimonialsTitle ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, testimonialsTitle: e.target.value } as CMSContent : prev)}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            placeholder="Historias de Transformacion"
                          />
                        </div>
                      </div>
                    </GlassCard>
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">CTA Final (Home)</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input
                            type="text"
                            value={editedContent?.ctaTitle ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, ctaTitle: e.target.value } as CMSContent : prev)}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            placeholder="Comienza tu transformacion hoy"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                          <textarea
                            value={editedContent?.ctaSubtitle ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, ctaSubtitle: e.target.value } as CMSContent : prev)}
                            rows={3}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto boton</label>
                            <input
                              type="text"
                              value={editedContent?.ctaButtonText ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, ctaButtonText: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="Solicitar Cita"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Enlace boton</label>
                            <input
                              type="text"
                              value={editedContent?.ctaButtonLink ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, ctaButtonLink: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="/portal"
                            />
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}

              {activeTab === 'Contacto' && (
                <motion.div
                  key="Contacto"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Contacto</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveCMS}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                        <Mail className="w-5 h-5 text-[var(--color-accent-val)]" />
                        Header
                      </h2>
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Eyebrow</label>
                          <input type="text" value={editedContent?.contacto?.heroEyebrow ?? ''} onChange={(e) => updateContactoField('heroEyebrow', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo</label>
                          <input type="text" value={editedContent?.contacto?.heroTitle ?? ''} onChange={(e) => updateContactoField('heroTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo</label>
                          <textarea value={editedContent?.contacto?.heroSubtitle ?? ''} onChange={(e) => updateContactoField('heroSubtitle', e.target.value)} rows={2} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                        </div>
                      </div>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Tarjetas de contacto</h2>
                        <button type="button" onClick={addContactoCard} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-sm border border-[var(--color-accent-border)]">
                          <Plus className="w-4 h-4" /> Anadir tarjeta
                        </button>
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleContactoCardsDragEnd}>
                        <SortableContext items={(editedContent?.contacto?.cards ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          <div className="space-y-3">
                            {(editedContent?.contacto?.cards ?? []).map((card, index) => (
                              <SortableContactoCardItem
                                key={`contact-card-${index}`}
                                card={card}
                                index={index}
                                onUpdate={(field, value) => updateContactoCardField(index, field, value)}
                                onRemove={() => removeContactoCard(index)}
                                onToggleActive={() => toggleContactoCardActive(index)}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Formulario</h2>
                      <div className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo de formulario</label>
                            <input type="text" value={editedContent?.contacto?.formTitle ?? ''} onChange={(e) => updateContactoField('formTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Subtitulo de formulario</label>
                            <input type="text" value={editedContent?.contacto?.formSubtitle ?? ''} onChange={(e) => updateContactoField('formSubtitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                          </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Nombre label</label><input type="text" value={editedContent?.contacto?.nameLabel ?? ''} onChange={(e) => updateContactoField('nameLabel', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Nombre placeholder</label><input type="text" value={editedContent?.contacto?.namePlaceholder ?? ''} onChange={(e) => updateContactoField('namePlaceholder', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Email label</label><input type="text" value={editedContent?.contacto?.emailLabel ?? ''} onChange={(e) => updateContactoField('emailLabel', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Email placeholder</label><input type="text" value={editedContent?.contacto?.emailPlaceholder ?? ''} onChange={(e) => updateContactoField('emailPlaceholder', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Telefono label</label><input type="text" value={editedContent?.contacto?.phoneLabel ?? ''} onChange={(e) => updateContactoField('phoneLabel', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Telefono placeholder</label><input type="text" value={editedContent?.contacto?.phonePlaceholder ?? ''} onChange={(e) => updateContactoField('phonePlaceholder', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Asunto label</label><input type="text" value={editedContent?.contacto?.subjectLabel ?? ''} onChange={(e) => updateContactoField('subjectLabel', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Asunto placeholder</label><input type="text" value={editedContent?.contacto?.subjectPlaceholder ?? ''} onChange={(e) => updateContactoField('subjectPlaceholder', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Mensaje label</label><input type="text" value={editedContent?.contacto?.messageLabel ?? ''} onChange={(e) => updateContactoField('messageLabel', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Mensaje placeholder</label><input type="text" value={editedContent?.contacto?.messagePlaceholder ?? ''} onChange={(e) => updateContactoField('messagePlaceholder', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                        </div>
                      </div>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Asuntos del formulario</h2>
                        <button type="button" onClick={addContactoSubject} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-sm border border-[var(--color-accent-border)]">
                          <Plus className="w-4 h-4" /> Anadir asunto
                        </button>
                      </div>
                      <DndContext collisionDetection={closestCenter} onDragEnd={handleContactoSubjectsDragEnd}>
                        <SortableContext items={(editedContent?.contacto?.subjects ?? []).map((_, i) => i.toString())} strategy={verticalListSortingStrategy}>
                          <div className="space-y-3">
                            {(editedContent?.contacto?.subjects ?? []).map((subject, index) => (
                              <SortableContactoSubjectItem
                                key={`contact-subject-${index}`}
                                subject={subject}
                                index={index}
                                onUpdate={(value) => updateContactoSubject(index, value)}
                                onRemove={() => removeContactoSubject(index)}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">CTA y mensaje de exito</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto boton enviar</label>
                          <input type="text" value={editedContent?.contacto?.submitText ?? ''} onChange={(e) => updateContactoField('submitText', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Titulo exito</label><input type="text" value={editedContent?.contacto?.successTitle ?? ''} onChange={(e) => updateContactoField('successTitle', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                          <div><label className="block text-sm text-[var(--color-text-secondary)] mb-2">Mensaje exito</label><input type="text" value={editedContent?.contacto?.successMessage ?? ''} onChange={(e) => updateContactoField('successMessage', e.target.value)} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]" /></div>
                        </div>
                      </div>
                    </GlassCard>

                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Mapa</h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">URL del mapa embebido</label>
                          <textarea value={editedContent?.contacto?.mapUrl ?? ''} onChange={(e) => updateContactoField('mapUrl', e.target.value)} rows={3} className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none" />
                        </div>
                        <div className="rounded-xl border border-border bg-muted/20 p-3">
                          <p className="text-xs text-[var(--color-text-secondary)] mb-2">Preview</p>
                          <div className="relative aspect-video rounded-xl overflow-hidden bg-black/30">
                            {editedContent?.contacto?.mapUrl ? (
                              <iframe
                                src={editedContent.contacto.mapUrl}
                                className="absolute inset-0 w-full h-full"
                                style={{ border: 0 }}
                                loading="lazy"
                                title="Mapa contacto preview"
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
                                Añade una URL de mapa para ver la previsualización
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}

              {activeTab === 'Footer' && (
                <motion.div
                  key="Footer"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Footer</h1>
                    <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveCMS}>
                      Guardar Cambios
                    </PremiumButton>
                  </div>

                  <div className="space-y-6">
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-[var(--color-accent-val)]" />
                        Contenido del Footer
                      </h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Texto descriptivo</label>
                          <textarea
                            value={editedContent?.footerText ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, footerText: e.target.value } as CMSContent : prev)}
                            rows={3}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Direccion</label>
                          <textarea
                            value={editedContent?.address ?? ''}
                            onChange={(e) => setEditedContent(prev => prev ? { ...prev, address: e.target.value } as CMSContent : prev)}
                            rows={2}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Telefono</label>
                            <input
                              type="text"
                              value={editedContent?.phone ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, phone: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">WhatsApp</label>
                            <input
                              type="text"
                              value={editedContent?.whatsapp ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, whatsapp: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Email</label>
                            <input
                              type="email"
                              value={editedContent?.email ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, email: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Instagram</label>
                            <input
                              type="text"
                              value={editedContent?.socialInstagram ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, socialInstagram: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Facebook</label>
                            <input
                              type="text"
                              value={editedContent?.socialFacebook ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, socialFacebook: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Twitter / X</label>
                            <input
                              type="text"
                              value={editedContent?.socialTwitter ?? ''}
                              onChange={(e) => setEditedContent(prev => prev ? { ...prev, socialTwitter: e.target.value } as CMSContent : prev)}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                            />
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}

              {/* ============================================
                  AVAILABILITY (Blocked Slots)
                  ============================================ */}
              {activeTab === 'availability' && (
                <motion.div
                  key="availability"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Gestión de Disponibilidad</h1>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {blockedSlots.length} franja{blockedSlots.length !== 1 ? 's' : ''} bloqueada{blockedSlots.length !== 1 ? 's' : ''}
                    </p>
                  </div>

                  {/* ── INTERACTIVE BLOCKING CALENDAR ── */}
                  <div className="space-y-6">
                    {/* Monthly Calendar Grid */}
                    <div className="glass-card rounded-2xl p-5 sm:p-6">
                      {/* Header: Month/Year + Navigation */}
                      <div className="flex items-center justify-between mb-6">
                        <button
                          onClick={() => {
                            if (calYear > nowCal.getFullYear() || (calYear === nowCal.getFullYear() && calMonth > nowCal.getMonth() + 1)) {
                              if (calMonth === 1) { setCalMonth(12); setCalYear(calYear - 1); }
                              else { setCalMonth(calMonth - 1); }
                            }
                          }}
                          disabled={!(calYear > nowCal.getFullYear() || (calYear === nowCal.getFullYear() && calMonth > nowCal.getMonth() + 1))}
                          className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
                            (calYear > nowCal.getFullYear() || (calYear === nowCal.getFullYear() && calMonth > nowCal.getMonth() + 1))
                              ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-dim)] hover:shadow-emerald-glow'
                              : 'text-[var(--color-text-secondary)]/30 cursor-not-allowed'
                          )}
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>

                        <h3 className="text-lg font-bold text-[var(--color-text-primary)] tracking-wide">
                          {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][calMonth - 1]} {calYear}
                        </h3>

                        <button
                          onClick={() => {
                            if (calMonth === 12) { setCalMonth(1); setCalYear(calYear + 1); }
                            else { setCalMonth(calMonth + 1); }
                          }}
                          className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-dim)] hover:shadow-emerald-glow transition-all duration-200"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Day names */}
                      <div className="grid grid-cols-7 gap-1 mb-2">
                        {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((name) => (
                          <div key={name} className="text-center text-xs font-semibold text-[var(--color-text-secondary)] py-2 uppercase tracking-wider">
                            {name}
                          </div>
                        ))}
                      </div>

                      {/* Days grid */}
                      {(() => {
                        const daysInMonth = new Date(calYear, calMonth, 0).getDate();
                        const firstDow = (() => { const d = new Date(calYear, calMonth - 1, 1).getDay(); return d === 0 ? 6 : d - 1; })();
                        const today = new Date(); today.setHours(0,0,0,0);

                        const fmtDate = (d: number) => `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

                        // Count blocked slots per day for indicators
                        const blockedByDate: Record<string, number> = {};
                        blockedSlots.forEach(s => { blockedByDate[s.date] = (blockedByDate[s.date] || 0) + 1; });

                        return (
                          <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: firstDow }).map((_, i) => (
                              <div key={`e-${i}`} className="aspect-square" />
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                              const day = i + 1;
                              const dateObj = new Date(calYear, calMonth - 1, day);
                              const isPast = dateObj < today;
                              const isToday = dateObj.getTime() === today.getTime();
                              const isSelected = calSelectedDay === day;
                              const dateKey = fmtDate(day);
                              const blockedCount = blockedByDate[dateKey] || 0;
                              const allBlocked = blockedCount >= timeSlots.length;

                              return (
                                <button
                                  key={day}
                                  disabled={isPast}
                                  onClick={() => {
                                    setCalSelectedDay(isSelected ? null : day);
                                    setPendingBlocks(new Set());
                                    setRangeStart(null);
                                  }}
                                  className={cn(
                                    'aspect-square rounded-xl flex flex-col items-center justify-center relative transition-all duration-200 text-sm font-medium',
                                    isPast && 'opacity-30 cursor-not-allowed text-[var(--color-text-secondary)]',
                                    isToday && !isSelected && !isPast && 'ring-1 ring-[var(--color-accent-border)]/50',
                                    isSelected && 'bg-[var(--color-accent-dim)] border border-accent text-[var(--color-text-primary)] shadow-emerald-glow scale-105',
                                    !isPast && !isSelected && 'text-[var(--color-text-primary)] hover:bg-[var(--color-accent-dim)] hover:scale-105 cursor-pointer',
                                  )}
                                >
                                  <span>{day}</span>
                                  {!isPast && blockedCount > 0 && (
                                    <div className="flex gap-0.5 mt-0.5">
                                      {allBlocked ? (
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                      ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                      )}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Legend */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 pt-4 border-t border-border/50 text-xs text-[var(--color-text-secondary)]">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent-dim)] border border-[var(--color-accent-border)]" />
                          Sin bloqueos
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                          Parcialmente bloqueado
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                          Día completo bloqueado
                        </span>
                      </div>
                    </div>

                    {/* ── SLOT PANEL — appears when a day is selected ── */}
                    <AnimatePresence mode="wait">
                      {calSelectedDay && !(() => {
                        const d = new Date(calYear, calMonth - 1, calSelectedDay);
                        const t = new Date(); t.setHours(0,0,0,0);
                        return d < t;
                      })() && (
                        <motion.div
                          key={`block-slots-${calYear}-${calMonth}-${calSelectedDay}`}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.25 }}
                          className="glass-card rounded-2xl p-5 sm:p-6"
                        >
                          {(() => {
                            const dateKey = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(calSelectedDay).padStart(2,'0')}`;
                            const blockedSet = new Set(blockedSlots.filter(s => s.date === dateKey).map(s => s.time));
                            const allSlotsBlocked = timeSlots.every(t => blockedSet.has(t));
                            const allPendingOrBlocked = timeSlots.every(t => blockedSet.has(t) || pendingBlocks.has(t));

                            return (
                              <>
                                <div className="flex items-center justify-between mb-5">
                                  <div className="flex items-center gap-3">
                                    <Clock className="w-5 h-5 text-[var(--color-accent-val)]" />
                                    <h4 className="font-bold text-[var(--color-text-primary)]">
                                      {new Date(calYear, calMonth - 1, calSelectedDay).toLocaleDateString('es-ES', {
                                        weekday: 'long',
                                        day: 'numeric',
                                        month: 'long',
                                      })}
                                    </h4>
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (allPendingOrBlocked) {
                                        // Deselect all pending
                                        setPendingBlocks(new Set());
                                      } else {
                                        // Select all non-blocked slots
                                        const allNew = new Set<string>();
                                        timeSlots.forEach(t => {
                                          if (!blockedSet.has(t)) allNew.add(t);
                                        });
                                        setPendingBlocks(allNew);
                                      }
                                      setRangeStart(null);
                                    }}
                                    disabled={allSlotsBlocked}
                                    className={cn(
                                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                                      allSlotsBlocked
                                        ? 'opacity-40 cursor-not-allowed border-border/30 text-[var(--color-text-secondary)]'
                                        : allPendingOrBlocked
                                          ? 'bg-muted/20 border-border/50 text-[var(--color-text-secondary)] hover:bg-muted/30'
                                          : 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25'
                                    )}
                                  >
                                    {allPendingOrBlocked ? 'Deseleccionar todo' : 'Seleccionar todo el día'}
                                  </button>
                                </div>

                                {/* Tip */}
                                {pendingBlocks.size === 0 && !allSlotsBlocked && (
                                  <p className="text-xs text-[var(--color-text-secondary)] mb-4 flex items-center gap-1.5">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Haz clic en una franja para seleccionarla. Haz clic en dos para seleccionar el rango.
                                  </p>
                                )}

                                {/* Time slots grid */}
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                                  {timeSlots.map((time) => {
                                    const isBlocked = blockedSet.has(time);
                                    const isPending = pendingBlocks.has(time);
                                    const isRangeStart = rangeStart === time;

                                    return (
                                      <button
                                        key={time}
                                        disabled={isBlocked}
                                        onClick={() => {
                                          if (isBlocked) return;

                                          if (rangeStart && rangeStart !== time) {
                                            // Range selection: mark all slots between rangeStart and this
                                            const startIdx = timeSlots.indexOf(rangeStart);
                                            const endIdx = timeSlots.indexOf(time);
                                            const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                                            const newPending = new Set(pendingBlocks);
                                            for (let j = from; j <= to; j++) {
                                              if (!blockedSet.has(timeSlots[j])) {
                                                newPending.add(timeSlots[j]);
                                              }
                                            }
                                            setPendingBlocks(newPending);
                                            setRangeStart(null);
                                          } else if (isPending && !isRangeStart) {
                                            // Deselect single slot
                                            const newPending = new Set(pendingBlocks);
                                            newPending.delete(time);
                                            setPendingBlocks(newPending);
                                            setRangeStart(null);
                                          } else if (isRangeStart) {
                                            // Cancel range, toggle this single slot
                                            const newPending = new Set(pendingBlocks);
                                            if (isPending) newPending.delete(time);
                                            else newPending.add(time);
                                            setPendingBlocks(newPending);
                                            setRangeStart(null);
                                          } else {
                                            // First click: set as range start and mark pending
                                            const newPending = new Set(pendingBlocks);
                                            newPending.add(time);
                                            setPendingBlocks(newPending);
                                            setRangeStart(time);
                                          }
                                        }}
                                        className={cn(
                                          'relative py-3 px-2 rounded-xl text-sm font-medium transition-all duration-200 border',
                                          // Already blocked in DB
                                          isBlocked && 'bg-red-500/15 border-red-500/30 text-red-400/70 cursor-not-allowed',
                                          // Pending block (selected for new blocking)
                                          !isBlocked && isPending && !isRangeStart && 'bg-orange-500/20 border-orange-400/50 text-orange-300 shadow-[0_0_10px_rgba(251,146,60,0.15)] ring-1 ring-orange-400/30',
                                          // Range start highlight
                                          !isBlocked && isRangeStart && 'bg-orange-500/30 border-orange-400/60 text-orange-200 shadow-[0_0_14px_rgba(251,146,60,0.25)] ring-2 ring-orange-400/40',
                                          // Available (not blocked, not pending)
                                          !isBlocked && !isPending && 'bg-[var(--color-accent-dim)] border-border/60 text-[var(--color-text-primary)] hover:bg-[var(--color-accent-dim)] hover:border-accent/50 hover:shadow-emerald-glow',
                                        )}
                                      >
                                        <span className="block">{time}</span>

                                        {/* Status indicators */}
                                        {isBlocked && (
                                          <Lock className="w-3 h-3 mx-auto mt-1 text-red-400/60" />
                                        )}
                                        {!isBlocked && isPending && (
                                          <span className="block text-[10px] mt-0.5 text-orange-400 font-semibold">Bloquear</span>
                                        )}
                                        {!isBlocked && isRangeStart && (
                                          <span className="block text-[10px] mt-0.5 text-orange-300 font-semibold">Inicio ▸</span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Reason input + delete checkbox + confirm button */}
                                {pendingBlocks.size > 0 && (
                                  <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mt-5 pt-5 border-t border-border/50 space-y-4"
                                  >
                                    <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
                                      <CalendarOff className="w-4 h-4 text-orange-400 flex-shrink-0" />
                                      <span className="text-sm text-orange-300 font-medium">
                                        {pendingBlocks.size} franja{pendingBlocks.size !== 1 ? 's' : ''} seleccionada{pendingBlocks.size !== 1 ? 's' : ''} para bloquear
                                      </span>
                                    </div>

                                    <div>
                                      <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Motivo (opcional)</label>
                                      <input
                                        type="text"
                                        value={blockReasonInput}
                                        onChange={(e) => setBlockReasonInput(e.target.value)}
                                        placeholder="Ej: Vacaciones, evento privado..."
                                        className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                                      />
                                    </div>

                                    {/* Checkbox: eliminar citas existentes */}
                                    <label className="flex items-center gap-3 p-3 rounded-xl border border-border/50 cursor-pointer hover:bg-muted/20 transition-colors">
                                      <input
                                        type="checkbox"
                                        checked={deleteOnBlock}
                                        onChange={(e) => setDeleteOnBlock(e.target.checked)}
                                        className="w-4 h-4 rounded border-border accent-red-500"
                                      />
                                      <div>
                                        <span className="text-sm text-[var(--color-text-primary)] font-medium">Eliminar citas existentes al bloquear</span>
                                        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                                          Si está activo, las citas (pendientes y aprobadas) en estas franjas se eliminarán permanentemente.
                                        </p>
                                      </div>
                                    </label>

                                    <div className="flex gap-3">
                                      <PremiumButton
                                        variant="cta"
                                        icon={<Lock className="w-4 h-4" />}
                                        disabled={savingBlocks}
                                        onClick={async () => {
                                          const slotsArray = Array.from(pendingBlocks).sort();

                                          // Si deleteOnBlock está activo, buscar citas afectadas
                                          if (deleteOnBlock) {
                                            const affectedAppointments = appointments.filter(appt => {
                                              // Buscar en preferredSlots
                                              const matchesPreferred = appt.preferredSlots?.some(
                                                ps => ps.date === dateKey && slotsArray.includes(ps.time)
                                              );
                                              // Buscar en approvedSlot
                                              const matchesApproved = appt.approvedSlot &&
                                                appt.approvedSlot.date === dateKey &&
                                                slotsArray.includes(appt.approvedSlot.time);
                                              return matchesPreferred || matchesApproved;
                                            });

                                            if (affectedAppointments.length > 0) {
                                              const approvedOnes = affectedAppointments.filter(a => a.status === 'approved');
                                              let msg = `Se eliminarán ${affectedAppointments.length} cita(s) en estas franjas.`;
                                              if (approvedOnes.length > 0) {
                                                msg += `\n\n⚠️ ATENCIÓN: ${approvedOnes.length} cita(s) APROBADA(S) serán eliminadas:\n`;
                                                msg += approvedOnes.map(a => `  - ${a.name} (${a.approvedSlot?.time || a.preferredSlots?.[0]?.time || '?'})`).join('\n');
                                              }
                                              msg += '\n\n¿Continuar con el bloqueo y eliminación?';
                                              if (!confirm(msg)) return;
                                            }
                                          }

                                          setSavingBlocks(true);
                                          try {
                                            // 1. Eliminar citas si deleteOnBlock
                                            if (deleteOnBlock) {
                                              const toDelete = appointments.filter(appt => {
                                                const matchesPreferred = appt.preferredSlots?.some(
                                                  ps => ps.date === dateKey && slotsArray.includes(ps.time)
                                                );
                                                const matchesApproved = appt.approvedSlot &&
                                                  appt.approvedSlot.date === dateKey &&
                                                  slotsArray.includes(appt.approvedSlot.time);
                                                return matchesPreferred || matchesApproved;
                                              });
                                              for (const appt of toDelete) {
                                                // Webhook BEFORE delete — data still available
                                                const trainerObj = trainers.find(t => t.id === appt.assignedTrainer);
                                                await sendWebhook({
                                                  action: 'deleted',
                                                  customerName: appt.name,
                                                  customerEmail: appt.email,
                                                  date: appt.approvedSlot?.date || appt.preferredSlots?.[0]?.date || '',
                                                  time: appt.approvedSlot?.time || appt.preferredSlots?.[0]?.time || '',
                                                  sessionType: appt.sessionType || '',
                                                  trainerName: trainerObj?.name || '',
                                                });
                                                // Decrement slot_occupancy for approved appointments before deleting
                                                if (appt.status === 'approved' && appt.approvedSlot) {
                                                  await decrementSlotOccupancy(appt.approvedSlot.date, appt.approvedSlot.time, parseInt(appt.duration, 10));
                                                }
                                                await deleteAppointmentFS(appt.id);
                                              }
                                              if (toDelete.length > 0) {
                                                await addActivityLog({
                                                  action: 'appointments_deleted_on_block',
                                                  adminEmail: user?.email || 'unknown',
                                                  details: `${dateKey}: ${toDelete.length} cita(s) eliminadas (${toDelete.map(a => a.name).join(', ')})`,
                                                });
                                              }
                                            }

                                            // 2. Crear blocked_slots
                                            for (const time of slotsArray) {
                                              await addBlockedSlotFS({
                                                date: dateKey,
                                                time,
                                                ...(blockReasonInput ? { reason: blockReasonInput } : {}),
                                                createdBy: user?.uid || 'unknown',
                                              });
                                            }
                                            await addActivityLog({
                                              action: 'blocked_slot_added',
                                              adminEmail: user?.email || 'unknown',
                                              details: `${dateKey} (${slotsArray.length} franjas: ${slotsArray[0]}-${slotsArray[slotsArray.length - 1]})`,
                                            });
                                            setPendingBlocks(new Set());
                                            setBlockReasonInput('');
                                            setRangeStart(null);
                                            await refreshData();
                                          } catch (err) {
                                            console.error('Error blocking slots:', err);
                                            alert('Error al bloquear franjas. Inténtalo de nuevo.');
                                          } finally {
                                            setSavingBlocks(false);
                                          }
                                        }}
                                        className="flex-1"
                                      >
                                        {savingBlocks ? 'Guardando...' : `Confirmar Bloqueo (${pendingBlocks.size})`}
                                      </PremiumButton>

                                      <PremiumButton
                                        variant="ghost"
                                        onClick={() => {
                                          setPendingBlocks(new Set());
                                          setRangeStart(null);
                                        }}
                                        className="text-[var(--color-text-secondary)]"
                                      >
                                        Cancelar
                                      </PremiumButton>
                                    </div>
                                  </motion.div>
                                )}
                              </>
                            );
                          })()}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* ── LIST OF BLOCKED SLOTS GROUPED BY DATE ── */}
                  <div className="space-y-3 mt-6">
                    {blockedSlots.length === 0 ? (
                      <GlassCard className="p-12 text-center">
                        <CalendarOff className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-secondary)] opacity-50" />
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">Sin franjas bloqueadas</h3>
                        <p className="text-[var(--color-text-secondary)]">
                          Todas las franjas horarias están disponibles para reservar.
                        </p>
                      </GlassCard>
                    ) : (
                      (() => {
                        const grouped: Record<string, BlockedSlot[]> = {};
                        blockedSlots
                          .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
                          .forEach((slot) => {
                            if (!grouped[slot.date]) grouped[slot.date] = [];
                            grouped[slot.date].push(slot);
                          });
                        return Object.entries(grouped).map(([date, slots]) => {
                          const slotDate = new Date(date + 'T00:00:00');
                          const isPast = slotDate < new Date(new Date().toDateString());
                          return (
                            <GlassCard key={date} className={cn('p-5', isPast && 'opacity-50')}>
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    'w-10 h-10 rounded-lg flex items-center justify-center',
                                    isPast ? 'bg-muted/30' : 'bg-red-500/20'
                                  )}>
                                    <Lock className={cn('w-5 h-5', isPast ? 'text-[var(--color-text-secondary)]' : 'text-red-400')} />
                                  </div>
                                  <div>
                                    <p className="text-[var(--color-text-primary)] font-medium">
                                      {slotDate.toLocaleDateString('es-ES', {
                                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                                      })}
                                    </p>
                                    <p className="text-xs text-[var(--color-text-secondary)]">{slots.length} franja{slots.length !== 1 ? 's' : ''} bloqueada{slots.length !== 1 ? 's' : ''}</p>
                                  </div>
                                </div>
                                <PremiumButton
                                  variant="ghost"
                                  size="sm"
                                  icon={<Trash2 className="w-4 h-4" />}
                                  onClick={async () => {
                                    if (confirm(`¿Desbloquear todas las franjas del ${slotDate.toLocaleDateString('es-ES')}?`)) {
                                      for (const s of slots) {
                                        await deleteBlockedSlotFS(s.id);
                                      }
                                      await addActivityLog({
                                        action: 'blocked_slot_removed',
                                        adminEmail: user?.email || 'unknown',
                                        details: `${date} (${slots.length} franjas)`,
                                      });
                                      await refreshData();
                                    }
                                  }}
                                  className="text-destructive hover:bg-destructive/10"
                                >
                                  Desbloquear día
                                </PremiumButton>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {slots.map((slot) => (
                                  <button
                                    key={slot.id}
                                    onClick={async () => {
                                      if (confirm(`¿Desbloquear ${slot.time}?`)) {
                                        await deleteBlockedSlotFS(slot.id);
                                        await addActivityLog({
                                          action: 'blocked_slot_removed',
                                          adminEmail: user?.email || 'unknown',
                                          details: `${slot.date} ${slot.time}`,
                                        });
                                        await refreshData();
                                      }
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-sm hover:bg-red-500/30 transition-colors flex items-center gap-1.5"
                                    title={slot.reason || 'Sin motivo'}
                                  >
                                    {slot.time}
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                ))}
                              </div>
                              {slots[0]?.reason && (
                                <p className="text-xs text-[var(--color-text-secondary)] mt-2">Motivo: {slots[0].reason}</p>
                              )}
                            </GlassCard>
                          );
                        });
                      })()
                    )}
                  </div>
                </motion.div>
              )}


              {/* ============================================
                  CONFIGURACIÓN GLOBAL
                  ============================================ */}
              {activeTab === 'config' && (
                <motion.div
                  key="config"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-6">Configuración Global</h1>

                  {/* ── Identidad Visual ── */}
                  <GlassCard className="p-6 mb-6">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1 flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-[var(--color-accent-val)]" />
                      Identidad Visual
                    </h2>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-5">
                      Logo que aparece en la barra de navegación y el pie de página de toda la web.
                    </p>
                    <div className="flex items-center gap-6">
                      {/* Logo preview */}
                      <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--color-accent-border)] bg-black/30 shrink-0">
                        <img
                          src={brandingConfig?.logoUrl ?? '/imagenes/logo.jpeg'}
                          alt="Logo actual"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">Logo actual</p>
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          {brandingConfig?.logoUrl ? 'Imagen personalizada en Firebase Storage' : 'Imagen predeterminada (logo.jpeg)'}
                        </p>
                        <PremiumButton
                          variant="outline"
                          size="sm"
                          icon={<ImageIcon className="w-4 h-4" />}
                          onClick={() => setLogoPickerOpen(true)}
                        >
                          Cambiar Logo
                        </PremiumButton>
                      </div>
                    </div>
                  </GlassCard>

                  <div className="grid lg:grid-cols-2 gap-6">
                    {/* Config Form */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Horario y Duración de Sesiones</h2>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                        Estos valores controlan las franjas horarias de todos los calendarios (portal de clientes y panel de administración).
                      </p>

                      <div className="space-y-5">
                        {/* Start Hour */}
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Hora de Inicio</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min={0}
                              max={23}
                              value={editConfig.startHour}
                              onChange={(e) => setEditConfig(prev => ({ ...prev, startHour: Math.max(0, Math.min(23, parseInt(e.target.value) || 0)) }))}
                              className="w-24 px-3 py-2 rounded-lg bg-muted/50 border border-white/10 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                            />
                            <span className="text-sm text-[var(--color-text-secondary)]">:00 h</span>
                          </div>
                        </div>

                        {/* End Hour */}
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Hora de Fin</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min={0}
                              max={23}
                              value={editConfig.endHour}
                              onChange={(e) => setEditConfig(prev => ({ ...prev, endHour: Math.max(0, Math.min(23, parseInt(e.target.value) || 0)) }))}
                              className="w-24 px-3 py-2 rounded-lg bg-muted/50 border border-white/10 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                            />
                            <span className="text-sm text-[var(--color-text-secondary)]">:00 h</span>
                          </div>
                        </div>

                        {/* Slot Interval */}
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Intervalo de Slots</label>
                          <select
                            value={editConfig.slotInterval ?? 30}
                            onChange={(e) => setEditConfig(prev => ({ ...prev, slotInterval: parseInt(e.target.value) }))}
                            className="w-48 px-3 py-2 rounded-lg bg-muted/50 border border-white/10 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                          >
                            <option value={30}>30 minutos</option>
                            <option value={60}>60 minutos</option>
                          </select>
                          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Cada cuánto tiempo empieza un nuevo slot en el calendario.</p>
                        </div>
                      </div>

                      {/* Validation */}
                      {editConfig.startHour >= editConfig.endHour && (
                        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          La hora de inicio debe ser menor que la hora de fin.
                        </div>
                      )}

                      {/* Save Button */}
                      <div className="mt-6 flex items-center gap-4">
                        <button
                          disabled={savingConfig || editConfig.startHour >= editConfig.endHour}
                          onClick={async () => {
                            setSavingConfig(true);
                            try {
                              await updateSiteConfigFS(editConfig);
                              setSiteConfig(editConfig);
                              await addActivityLog({
                                action: 'site_config_updated',
                                adminEmail: user?.email || 'unknown',
                                details: `Horario: ${editConfig.startHour}:00-${editConfig.endHour}:00, Intervalo: ${editConfig.slotInterval ?? 30}min`,
                              });
                            } catch (err) {
                              console.error('Error saving config:', err);
                              alert('Error al guardar la configuración');
                            } finally {
                              setSavingConfig(false);
                            }
                          }}
                          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright text-[var(--color-bg-base)] font-semibold hover:shadow-lg hover:shadow-emerald/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {savingConfig ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          {savingConfig ? 'Guardando...' : 'Guardar Configuración'}
                        </button>

                        {/* Reset button */}
                        {(editConfig.startHour !== siteConfig.startHour || editConfig.endHour !== siteConfig.endHour || (editConfig.slotInterval ?? 30) !== (siteConfig.slotInterval ?? 30)) && (
                          <button
                            onClick={() => setEditConfig({ ...siteConfig })}
                            className="px-4 py-2.5 rounded-xl border border-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-white/20 transition-colors text-sm"
                          >
                            Descartar cambios
                          </button>
                        )}
                      </div>
                    </GlassCard>

                    {/* Preview */}
                    <GlassCard className="p-6">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Vista Previa de Franjas</h2>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                        Estas son las franjas que se generarán con la configuración actual:
                      </p>

                      {editConfig.startHour < editConfig.endHour ? (
                        <>
                          <div className="flex flex-wrap gap-2 mb-4">
                            {generateTimeSlots(editConfig).map((slot) => (
                              <span
                                key={slot}
                                className="px-3 py-1.5 rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)] text-sm font-mono"
                              >
                                {slot}
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            Total: {generateTimeSlots(editConfig).length} franjas &middot; Cada {editConfig.slotInterval ?? 30} min &middot; De {String(editConfig.startHour).padStart(2, '0')}:00 a {String(editConfig.endHour).padStart(2, '0')}:00
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-[var(--color-text-secondary)] italic">Corrige el horario para ver la vista previa.</p>
                      )}

                      {/* Current saved config */}
                      <div className="mt-6 pt-4 border-t border-white/10">
                        <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">Configuración Guardada Actual</h3>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                          <span>Inicio: <strong className="text-[var(--color-text-primary)]">{String(siteConfig.startHour).padStart(2, '0')}:00</strong></span>
                          <span>Fin: <strong className="text-[var(--color-text-primary)]">{String(siteConfig.endHour).padStart(2, '0')}:00</strong></span>
                          <span>Intervalo: <strong className="text-[var(--color-text-primary)]">{siteConfig.slotInterval ?? 30} min</strong></span>
                          <span>Franjas: <strong className="text-[var(--color-text-primary)]">{timeSlots.length}</strong></span>
                        </div>
                      </div>
                    </GlassCard>

                    {/* Configuración de Bonos */}
                    <GlassCard className="p-6 lg:col-span-2">
                      <div className="flex items-center gap-3 mb-4">
                        <Ticket className="w-5 h-5 text-[var(--color-accent-val)]" />
                        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Configuración de Bonos</h2>
                      </div>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                        Define la duración de validez para todos los bonos asignados. Al cambiar este valor se recalculará la fecha de expiración de todos los bonos activos.
                      </p>

                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Duración de Expiración</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min={1}
                            value={editBonoConfig}
                            onChange={(e) => setEditBonoConfig(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-24 px-3 py-2 rounded-lg bg-muted/50 border border-white/10 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                          />
                          <span className="text-sm text-[var(--color-text-secondary)]">mes(es)</span>
                        </div>
                      </div>

                      <div className="mt-6 flex items-center gap-4">
                        <button
                          disabled={savingBonoConfig || editBonoConfig === (siteConfig.bonoExpirationMonths || 1)}
                          onClick={async () => {
                            const confirmed = window.confirm(
                              'Este cambio afectará a todos los bonos activos recalculando su fecha de expiración. ¿Continuar?'
                            );
                            if (!confirmed) return;
                            setSavingBonoConfig(true);
                            try {
                              await updateSiteConfigFS({ bonoExpirationMonths: editBonoConfig });
                              await recalculateAllBonoExpirations(editBonoConfig);
                              setSiteConfig(prev => ({ ...prev, bonoExpirationMonths: editBonoConfig }));
                              await addActivityLog({
                                action: 'bono_config_updated',
                                adminEmail: user?.email || 'unknown',
                                details: `Expiración: ${editBonoConfig} mes(es)`,
                              });
                              await refreshData();
                            } catch (err) {
                              console.error('Error saving bono config:', err);
                              alert('Error al guardar la configuración de bonos');
                            } finally {
                              setSavingBonoConfig(false);
                            }
                          }}
                          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright text-[var(--color-bg-base)] font-semibold hover:shadow-lg hover:shadow-emerald/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {savingBonoConfig ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          {savingBonoConfig ? 'Guardando...' : 'Guardar Configuración de Bonos'}
                        </button>

                        {editBonoConfig !== (siteConfig.bonoExpirationMonths || 1) && (
                          <button
                            onClick={() => setEditBonoConfig(siteConfig.bonoExpirationMonths || 1)}
                            className="px-4 py-2.5 rounded-xl border border-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-white/20 transition-colors text-sm"
                          >
                            Descartar cambios
                          </button>
                        )}
                      </div>

                      {/* Current saved bono config */}
                      <div className="mt-6 pt-4 border-t border-white/10">
                        <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">Configuración Actual</h3>
                        <div className="text-sm text-[var(--color-text-secondary)]">
                          Expiración: <strong className="text-[var(--color-text-primary)]">{siteConfig.bonoExpirationMonths || 1} mes(es)</strong>
                        </div>
                      </div>
                    </GlassCard>
                  </div>
                </motion.div>
              )}

            </AnimatePresence>

            {/* Advanced Image Manager Modal - outside AnimatePresence mode="wait" */}
            <AnimatePresence>
              {activeImageManager && (
                <ContextualImageManager
                  defaultFolder={activeImageManager.folder}
                  currentUrl={activeImageManager.currentUrl}
                  onSelect={activeImageManager.onSelect}
                  onClose={() => setActiveImageManager(null)}
                />
              )}
            </AnimatePresence>

            {/* Logo picker */}
            <MediaPicker
              open={logoPickerOpen}
              onClose={() => setLogoPickerOpen(false)}
              filterType="image"
              onSelect={async (file) => {
                await updateBrandingConfig({
                  logoUrl: file.url,
                  logoStoragePath: file.storagePath,
                  updatedAt: new Date().toISOString(),
                });
                setBrandingConfig({ logoUrl: file.url, logoStoragePath: file.storagePath, updatedAt: new Date().toISOString() });
                setLogoPickerOpen(false);
              }}
            />

            <MediaPicker
              open={centroPickerOpen}
              onClose={() => {
                setCentroPickerOpen(false);
                setCentroPickerIndex(null);
              }}
              filterType="image"
              onSelect={async (file) => {
                if (centroPickerIndex === null) return;
                setEditedContent((prev) => {
                  if (!prev) return prev;
                  const zonas = [...(prev.centro?.zonas ?? [])];
                  if (!zonas[centroPickerIndex]) return prev;
                  zonas[centroPickerIndex] = { ...zonas[centroPickerIndex], image: file.url };
                  return { ...prev, centro: { ...prev.centro, zonas } } as CMSContent;
                });
                setCentroPickerOpen(false);
                setCentroPickerIndex(null);
              }}
            />

            <MediaPicker
              open={galeriaTrainingPickerOpen}
              onClose={() => {
                setGaleriaTrainingPickerOpen(false);
                setGaleriaTrainingPickerIndex(null);
              }}
              onSelect={async (file) => {
                if (galeriaTrainingPickerIndex === null) return;
                setEditedContent((prev) => {
                  if (!prev) return prev;
                  const trainings = [...(prev.galeria?.trainings ?? [])];
                  if (!trainings[galeriaTrainingPickerIndex]) return prev;
                  trainings[galeriaTrainingPickerIndex] = {
                    ...trainings[galeriaTrainingPickerIndex],
                    mediaUrl: file.url,
                    mediaType: file.type,
                  };
                  return { ...prev, galeria: { ...prev.galeria, trainings } } as CMSContent;
                });
                setGaleriaTrainingPickerOpen(false);
                setGaleriaTrainingPickerIndex(null);
              }}
            />

            <MediaPicker
              open={heroBackgroundPickerOpen}
              onClose={() => setHeroBackgroundPickerOpen(false)}
              onSelect={async (file) => {
                setEditedContent((prev) => prev ? {
                  ...prev,
                  heroBackgroundUrl: file.url,
                  heroBackgroundType: file.type,
                } as CMSContent : prev);
                setHeroBackgroundPickerOpen(false);
              }}
            />

            <MediaPicker
              open={aboutHomePickerOpen}
              onClose={() => setAboutHomePickerOpen(false)}
              filterType="image"
              onSelect={async (file) => {
                setEditedContent((prev) => prev ? { ...prev, aboutImage: file.url } as CMSContent : prev);
                setAboutHomePickerOpen(false);
              }}
            />

            {/* ============================================
                ASSIGN BONO MODAL
                ============================================ */}
            <AnimatePresence>
              {showAssignBonoModal && assignBonoClient && (
                <motion.div
                  key="assign-bono-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => setShowAssignBonoModal(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-lg"
                  >
                    <GlassCard className="p-6">
                      <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">Asignar Bono</h2>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                        Asigna un bono a <strong className="text-[var(--color-text-primary)]">{assignBonoClient.name}</strong>
                      </p>

                      {/* Warning if client already has active bono */}
                      {clientBonos[assignBonoClient.uid] && (
                        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          Este cliente ya tiene un bono activo. Asignar uno nuevo reemplazará el actual.
                        </div>
                      )}

                      <div className="space-y-5">
                        {/* Tamaño del bono */}
                        <div>
                          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Tamaño del Bono</label>
                          <div className="flex gap-3">
                            {([240, 360, 480] as const).map((tamano) => (
                              <button
                                key={tamano}
                                onClick={() => setAssignBonoTamano(tamano)}
                                className={cn(
                                  "flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all",
                                  assignBonoTamano === tamano
                                    ? "bg-[var(--color-accent-dim)] border-[var(--color-accent-border)] text-[var(--color-accent-val)]"
                                    : "bg-muted/20 border-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                )}
                              >
                                {tamano / 60}h / mes
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Summary */}
                        <div className="p-4 rounded-xl bg-muted/10 border border-white/5">
                          <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">Resumen del Bono</h3>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-[var(--color-text-secondary)]">Cliente</span>
                              <span className="text-[var(--color-text-primary)]">{assignBonoClient.name}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--color-text-secondary)]">Tipo</span>
                              <span className="text-[var(--color-text-primary)]">Bono Mensual</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--color-text-secondary)]">Horas</span>
                              <span className="text-[var(--color-text-primary)]">
                                {assignBonoTamano / 60}h ({assignBonoTamano} min)
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--color-text-secondary)]">Expira</span>
                              <span className="text-[var(--color-text-primary)]">
                                {(() => {
                                  const exp = new Date();
                                  exp.setMonth(exp.getMonth() + (siteConfig.bonoExpirationMonths || 1));
                                  return exp.toLocaleDateString('es-ES');
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-3 justify-end mt-6">
                        <button
                          onClick={() => setShowAssignBonoModal(false)}
                          className="px-4 py-2.5 rounded-xl border border-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          disabled={savingBono}
                          onClick={async () => {
                            setSavingBono(true);
                            try {
                              // Deactivate existing bono if any
                              const existingBono = clientBonos[assignBonoClient.uid];
                              if (existingBono) {
                                await deactivateBono(existingBono.id);
                              }

                              const now = new Date();
                              const expiration = new Date(now);
                              expiration.setMonth(expiration.getMonth() + (siteConfig.bonoExpirationMonths || 1));

                              await assignBono({
                                userId: assignBonoClient.uid,
                                tamano: assignBonoTamano,
                                minutosTotales: assignBonoTamano,
                                minutosRestantes: assignBonoTamano,
                                fechaAsignacion: now.toISOString(),
                                fechaExpiracion: expiration.toISOString(),
                                estado: 'activo',
                                historial: [],
                                asignadoPor: user?.email || 'admin',
                              });

                              await addActivityLog({
                                action: 'bono_assigned',
                                adminEmail: user?.email || 'unknown',
                                details: `Cliente: ${assignBonoClient.name}, Bono Mensual ${assignBonoTamano / 60}h`,
                              });

                              setShowAssignBonoModal(false);
                              await refreshData();
                            } catch (err) {
                              console.error('Error assigning bono:', err);
                              alert('Error al asignar el bono');
                            } finally {
                              setSavingBono(false);
                            }
                          }}
                          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright text-[var(--color-bg-base)] font-semibold hover:shadow-lg hover:shadow-emerald/25 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          {savingBono ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
                          {savingBono ? 'Asignando...' : 'Asignar Bono'}
                        </button>
                      </div>
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ============================================
                BONO HISTORY MODAL
                ============================================ */}
            <AnimatePresence>
              {showBonoHistoryModal && (
                <motion.div
                  key="bono-history-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => setShowBonoHistoryModal(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-lg max-h-[80vh] overflow-y-auto"
                  >
                    <GlassCard className="p-6">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Historial — {bonoHistoryClientName}</h2>
                        </div>
                        <button onClick={() => setShowBonoHistoryModal(false)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {/* ── Bonos ── */}
                      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">Bonos</h3>
                      {bonoHistoryData.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-secondary)] text-center py-4 mb-4">Sin historial de bonos.</p>
                      ) : (
                        <div className="space-y-4 mb-6">
                          {bonoHistoryData.map((bono) => (
                            <div key={bono.id} className="p-4 rounded-xl bg-muted/10 border border-white/5">
                              <div className="flex items-center justify-between mb-2">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-xs font-medium",
                                  bono.estado === 'activo' ? "bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]" :
                                  bono.estado === 'agotado' ? "bg-amber-500/10 text-amber-400" :
                                  bono.estado === 'eliminado' ? "bg-red-500/10 text-red-400" :
                                  "bg-muted/20 text-[var(--color-text-secondary)]"
                                )}>
                                  {bono.estado.charAt(0).toUpperCase() + bono.estado.slice(1)}
                                </span>
                                <span className="text-xs text-[var(--color-text-secondary)]">
                                  {new Date(bono.fechaAsignacion).toLocaleDateString('es-ES')}
                                </span>
                              </div>
                              <div className="text-sm text-[var(--color-text-primary)] mb-1">
                                Bono Mensual {getBonoMinutosTotales(bono) / 60}h
                              </div>
                              <div className="text-xs text-[var(--color-text-secondary)] mb-2">
                                {formatMinutos(getBonoMinutosRestantes(bono))} restantes de {formatMinutos(getBonoMinutosTotales(bono))} · Expira: {new Date(bono.fechaExpiracion).toLocaleDateString('es-ES')}
                              </div>
                              {(bono.historial?.length ?? 0) > 0 && (
                                <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
                                  {bono.historial.map((h, i) => (
                                    <div key={i} className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                                      <span>{new Date(h.fecha).toLocaleDateString('es-ES')}</span>
                                      <span>{h.tipo}{h.duracion && h.duracion !== '-' ? ` · ${h.duracion}min` : ''}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Citas ── */}
                      <div className="pt-4 border-t border-white/5">
                        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">Citas</h3>
                        {clientAppointmentsHistory.length === 0 ? (
                          <p className="text-sm text-[var(--color-text-secondary)] text-center py-4">Sin historial de citas.</p>
                        ) : (
                          <div className="space-y-3">
                            {clientAppointmentsHistory.map((appt) => {
                              const slot = appt.approvedSlot || appt.preferredSlots?.[0];
                              const apptStatus = statusConfig[appt.status];
                              return (
                                <div key={appt.id} className="p-3 rounded-xl bg-muted/10 border border-white/5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-[var(--color-text-primary)] font-medium">
                                      {serviceLabels[appt.serviceType] || appt.serviceType}
                                    </span>
                                    <span className={cn(
                                      "px-2 py-0.5 rounded text-xs font-medium border",
                                      apptStatus.color
                                    )}>
                                      {apptStatus.label}
                                    </span>
                                  </div>
                                  <div className="text-xs text-[var(--color-text-secondary)]">
                                    {slot
                                      ? `${new Date(slot.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · ${slot.time}`
                                      : '—'
                                    }
                                    {appt.duration && ` · ${appt.duration} min`}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ============================================
                APPROVAL MODAL
                ============================================ */}
            <AnimatePresence>
              {showApprovalModal && selectedAppointmentId && (
                <motion.div
                  key="approval-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => setShowApprovalModal(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-lg"
                  >
                    <GlassCard className="p-6">
                      <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">Aprobar Cita</h2>
                       <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                        Asigna un entrenador antes de confirmar. El campo es opcional.
                      </p>

                      {/* Pick one of the client's preferred slots as approved slot */}
                      {(() => {
                        const appt = appointments.find(a => a.id === selectedAppointmentId);
                        if (!appt) return null;
                        return (
                          <div className="mb-4">
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Franja confirmada</label>
                            <div className="flex flex-wrap gap-2">
                              {appt.preferredSlots.map((slot, idx) => {
                                const isSelected = approvalData.assignedTrainer === '__slot__' + idx.toString();
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setApprovalData(prev => ({
                                      ...prev,
                                      assignedTrainer: prev.assignedTrainer === '__slot__' + idx.toString()
                                        ? prev.assignedTrainer
                                        : prev.assignedTrainer,
                                    }))}
                                    className={cn(
                                      'px-3 py-1.5 rounded-lg text-sm transition-colors',
                                      'bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]'
                                    )}
                                  >
                                    {new Date(slot.date).toLocaleDateString('es-ES', {
                                      weekday: 'short',
                                      day: 'numeric',
                                      month: 'short',
                                    })} - {slot.time}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      <div className="space-y-4 mb-6">
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Entrenador asignado</label>
                          <select
                            value={approvalData.assignedTrainer}
                            onChange={(e) => setApprovalData({ ...approvalData, assignedTrainer: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                          >
                            <option value="">Sin asignar</option>
                            {trainers.filter(t => t.active).map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Tipo de sesión</label>
                          {(() => {
                            const appt = appointments.find(a => a.id === selectedAppointmentId);
                            const raw = appt?.serviceType || '';
                            return raw ? (
                              <span className="inline-block px-3 py-1.5 rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] text-sm font-medium">
                                {serviceLabels[raw] || raw}
                              </span>
                            ) : (
                              <span className="text-sm text-[var(--color-text-secondary)] italic">No especificado por el cliente</span>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex gap-3 justify-end">
                        <PremiumButton
                          variant="ghost"
                          onClick={() => {
                            setShowApprovalModal(false);
                            setSelectedAppointmentId(null);
                            setApprovalData({ assignedTrainer: '', sessionType: '' });
                          }}
                        >
                          Cancelar
                        </PremiumButton>
                        <PremiumButton
                          variant="cta"
                          icon={<Check className="w-4 h-4" />}
                          onClick={async () => {
                            const extra: { assignedTrainer?: string; sessionType?: string; approvedSlot?: TimeSlot } = {};
                            if (approvalData.assignedTrainer) extra.assignedTrainer = approvalData.assignedTrainer;
                            // sessionType comes from the appointment's serviceType (client chose it at booking)
                            const appt = appointments.find(a => a.id === selectedAppointmentId);
                            if (appt?.serviceType) extra.sessionType = appt.serviceType;
                            if (appt && appt.preferredSlots.length > 0) {
                              extra.approvedSlot = appt.preferredSlots[0];
                            }
                            await handleStatusUpdate(selectedAppointmentId, 'approved', extra);
                            // Webhook after approval — data is still in Firestore
                            if (appt) {
                              const trainerObj = trainers.find(t => t.id === (extra.assignedTrainer || appt.assignedTrainer));
                              await sendWebhook({
                                action: 'confirmed',
                                customerName: appt.name,
                                customerEmail: appt.email,
                                date: extra.approvedSlot?.date || appt.preferredSlots?.[0]?.date || '',
                                time: extra.approvedSlot?.time || appt.preferredSlots?.[0]?.time || '',
                                sessionType: extra.sessionType || appt.serviceType || '',
                                trainerName: trainerObj?.name || '',
                              });
                            }
                          }}
                        >
                          Confirmar Aprobación
                        </PremiumButton>
                      </div>
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ============================================
                MODIFICAR FRANJA MODAL
                ============================================ */}
            <AnimatePresence>
              {showEditSlotModal && selectedAppointmentId && (
                <motion.div
                  key="edit-slot-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => {
                    setShowEditSlotModal(false);
                    setSelectedAppointmentId(null);
                    setEditSlotData({ date: '', time: '' });
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-lg"
                  >
                    <GlassCard className="p-6">
                      {(() => {
                        const appt = appointments.find(a => a.id === selectedAppointmentId);
                        const isApproved = appt?.status === 'approved';

                        // Compute unavailable times for the selected date
                        const selectedDate = editSlotData.date;
                        const blockedTimes = new Set(
                          blockedSlots.filter(s => s.date === selectedDate).map(s => s.time)
                        );
                        const occupiedTimes = new Set(
                          appointments
                            .filter(a =>
                              a.id !== selectedAppointmentId &&
                              a.status === 'approved' &&
                              a.approvedSlot?.date === selectedDate
                            )
                            .map(a => a.approvedSlot!.time)
                        );
                        const unavailableTimes = new Set([...blockedTimes, ...occupiedTimes]);

                        return (
                          <>
                            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">Modificar</h2>
                            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                              {isApproved
                                ? 'Cambia la franja aprobada de esta cita. Se actualizará directamente.'
                                : 'Cambia la franja preferida de esta cita. Se actualizará directamente.'}
                            </p>

                            <div className="space-y-4 mb-6">
                              <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Fecha</label>
                                <input
                                  type="date"
                                  value={editSlotData.date}
                                  onChange={(e) => setEditSlotData({ date: e.target.value, time: '' })}
                                  min={new Date().toISOString().split('T')[0]}
                                  className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Hora</label>
                                <select
                                  value={editSlotData.time}
                                  onChange={(e) => setEditSlotData(prev => ({ ...prev, time: e.target.value }))}
                                  className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                                >
                                  <option value="">Seleccionar hora</option>
                                  {timeSlots.map((t) => {
                                    const isBlocked = blockedTimes.has(t);
                                    const isOccupied = occupiedTimes.has(t);
                                    const isUnavailable = isBlocked || isOccupied;
                                    const label = isBlocked ? `${t} — Bloqueada` : isOccupied ? `${t} — Ocupada` : t;
                                    return (
                                      <option key={t} value={t} disabled={isUnavailable} style={isUnavailable ? { color: '#555' } : undefined}>
                                        {label}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            </div>

                            <div className="flex gap-3 justify-end">
                              <PremiumButton
                                variant="ghost"
                                onClick={() => {
                                  setShowEditSlotModal(false);
                                  setSelectedAppointmentId(null);
                                  setEditSlotData({ date: '', time: '' });
                                }}
                              >
                                Cancelar
                              </PremiumButton>
                              <PremiumButton
                                variant="cta"
                                icon={<CalendarClock className="w-4 h-4" />}
                                onClick={async () => {
                                  if (!editSlotData.date || !editSlotData.time) {
                                    alert('Selecciona fecha y hora.');
                                    return;
                                  }
                                  try {
                                    // If approved, decrement old slot occupancy and increment new slot
                                    if (isApproved && appt?.approvedSlot) {
                                      const dur = parseInt(appt?.duration || '60', 10);
                                      await decrementSlotOccupancy(appt.approvedSlot.date, appt.approvedSlot.time, dur);
                                      await incrementSlotOccupancy(editSlotData.date, editSlotData.time, dur);
                                    }
                                    await updateAppointmentSlotFS(
                                      selectedAppointmentId,
                                      appt?.status || 'pending',
                                      editSlotData
                                    );
                                    await addActivityLog({
                                      action: 'appointment_slot_modified',
                                      adminEmail: user?.email || 'unknown',
                                      details: `Cita ID: ${selectedAppointmentId} → ${editSlotData.date} ${editSlotData.time}`,
                                    });
                                    await refreshData();
                                    setShowEditSlotModal(false);
                                    setSelectedAppointmentId(null);
                                    setEditSlotData({ date: '', time: '' });
                                  } catch (err) {
                                    console.error('Error modificando franja:', err);
                                    alert('Error al modificar la franja.');
                                  }
                                }}
                              >
                                Guardar Cambio
                              </PremiumButton>
                            </div>
                          </>
                        );
                      })()}
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ============================================
                TESTIMONIAL EDIT MODAL
                ============================================ */}
            <AnimatePresence>
              {editingTestimonial && (
                <motion.div
                  key="testimonial-edit-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => setEditingTestimonial(null)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-lg"
                  >
                    <GlassCard className="p-6">
                      <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                        {editingTestimonial.id.startsWith('new-') ? 'Nuevo Testimonio' : 'Editar Testimonio'}
                      </h2>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                        {editingTestimonial.id.startsWith('new-') ? 'Crea un nuevo testimonio' : `Editando: ${editingTestimonial.name}`}
                      </p>

                      <div className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Nombre *</label>
                            <input
                              type="text"
                              value={editingTestimonial.name}
                              onChange={(e) => setEditingTestimonial({ ...editingTestimonial, name: e.target.value })}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="María García"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Cargo / Rol</label>
                            <input
                              type="text"
                              value={editingTestimonial.role}
                              onChange={(e) => setEditingTestimonial({ ...editingTestimonial, role: e.target.value })}
                              className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)]"
                              placeholder="Cliente, Atleta, …"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Testimonio *</label>
                          <textarea
                            value={editingTestimonial.content}
                            onChange={(e) => setEditingTestimonial({ ...editingTestimonial, content: e.target.value })}
                            rows={4}
                            className="w-full px-4 py-3 rounded-xl bg-input border border-border text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-val)] resize-none"
                            placeholder="Texto del testimonio…"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                            Valoración: {editingTestimonial.rating} estrella{editingTestimonial.rating !== 1 ? 's' : ''}
                          </label>
                          <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                onClick={() => setEditingTestimonial({ ...editingTestimonial, rating: star })}
                                className="focus:outline-none"
                              >
                                <Star className={cn('w-6 h-6 transition-colors', star <= editingTestimonial.rating ? 'text-[var(--color-accent-val)] fill-accent' : 'text-[var(--color-text-secondary)]')} />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3 mt-6 justify-end">
                        <PremiumButton variant="outline" onClick={() => setEditingTestimonial(null)}>
                          Cancelar
                        </PremiumButton>
                        <PremiumButton variant="cta" icon={<Save className="w-4 h-4" />} onClick={handleSaveTestimonial}>
                          Guardar Testimonio
                        </PremiumButton>
                      </div>
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ============================================
                DELETE BONO CONFIRMATION MODAL
                ============================================ */}
            <AnimatePresence>
              {showDeleteBonoModal && deleteBonoClient && (
                <motion.div
                  key="delete-bono-modal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => setShowDeleteBonoModal(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-md"
                  >
                    <GlassCard className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                          <Trash2 className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Eliminar Bono</h2>
                          <p className="text-sm text-[var(--color-text-secondary)]">{deleteBonoClient.name}</p>
                        </div>
                      </div>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                        ¿Seguro que quieres eliminar el bono activo de{' '}
                        <strong className="text-[var(--color-text-primary)]">{deleteBonoClient.name}</strong>?
                        El historial de sesiones se conservará. Esta acción no se puede deshacer.
                      </p>
                      <div className="flex gap-3 justify-end">
                        <PremiumButton variant="outline" onClick={() => { setShowDeleteBonoModal(false); setDeleteBonoClient(null); }}>
                          Cancelar
                        </PremiumButton>
                        <button
                          onClick={async () => {
                            const bono = clientBonos[deleteBonoClient.uid]!;
                            try {
                              await deleteBono(bono.id);
                              await addActivityLog({ action: 'bono_deleted', adminEmail: user?.email || 'unknown', details: `Cliente: ${deleteBonoClient.name}, Bono: ${bono.id}` });
                              setShowDeleteBonoModal(false);
                              setDeleteBonoClient(null);
                              await refreshData();
                            } catch (err) {
                              console.error('Error deleting bono:', err);
                              alert('Error al eliminar el bono');
                            }
                          }}
                          className="px-4 py-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors text-sm font-medium flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" /> Eliminar Bono
                        </button>
                      </div>
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

          </main>
        </div>
      </div>
    </div >
  );
}



