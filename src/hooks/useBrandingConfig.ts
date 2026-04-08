'use client';

import { useState, useEffect } from 'react';
import { getBrandingConfig } from '@/lib/firestore';
import type { BrandingConfig } from '@/types';

export function useBrandingConfig() {
    const [config, setConfig] = useState<BrandingConfig | null>(null);

    useEffect(() => {
        getBrandingConfig().then(setConfig);
    }, []);

    return { logoUrl: config?.logoUrl ?? null };
}
