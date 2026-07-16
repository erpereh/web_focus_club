import { cn } from '@/lib/utils';

export type MessagesSection = 'conversations' | 'suggestions';

export default function MessagesSectionTabs({
    value,
    onChange,
}: {
    value: MessagesSection;
    onChange: (section: MessagesSection) => void;
}) {
    return (
        <div
            className="mb-4 inline-flex rounded-xl border border-border bg-[var(--color-bg-surface)] p-1"
            role="tablist"
            aria-label="Secciones de mensajes"
        >
            {([
                ['conversations', 'Conversaciones'],
                ['suggestions', 'Sugerencias'],
            ] as const).map(([section, label]) => (
                <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={value === section}
                    onClick={() => onChange(section)}
                    className={cn(
                        'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                        value === section
                            ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] ring-1 ring-[var(--color-accent-border)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]',
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
