'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { BrandingConfig } from '@/types';

export function useBrandingConfig() {
    const [config, setConfig] = useState<BrandingConfig | null>(null);

    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, 'site_config', 'general'), (snapshot) => {
            setConfig(snapshot.exists() ? (snapshot.data() as BrandingConfig) : null);
        });

        return unsubscribe;
    }, []);

    return { logoUrl: config?.logoUrl?.trim() ? config.logoUrl : null };
}
