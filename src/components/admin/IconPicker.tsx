'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { DynamicIcon, iconMap } from '@/components/ui/DynamicIcon';

interface IconPickerProps {
    value: string;
    onChange: (name: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
    const [search, setSearch] = useState('');
    const allIcons = Object.keys(iconMap);
    const filtered = search
        ? allIcons.filter((n) => n.toLowerCase().includes(search.toLowerCase()))
        : allIcons;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="w-10 h-10 rounded-lg border border-[var(--color-border-base)] bg-[var(--color-bg-surface)] flex items-center justify-center text-[var(--color-accent-val)] hover:bg-[var(--color-bg-card-hover)] transition-colors flex-shrink-0"
                    title={value}
                >
                    <DynamicIcon name={value} className="w-5 h-5" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-72 p-3 z-[200] bg-[#1a1a1a] border border-[var(--color-border-base)] rounded-xl shadow-2xl"
                align="start"
                sideOffset={6}
            >
                <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar icono..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border-base)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-val)]"
                    />
                </div>
                <div className="grid grid-cols-6 gap-1 max-h-52 overflow-y-auto">
                    {filtered.map((name) => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => onChange(name)}
                            title={name}
                            className={`p-2 rounded-lg transition-colors ${
                                value === name
                                    ? 'bg-[var(--color-accent-val)]/20 text-[var(--color-accent-val)]'
                                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
                        >
                            <DynamicIcon name={name} className="w-4 h-4" />
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
