'use client';

import { useEffect, useState } from 'react';
import { subscribeSiteConfig } from '@/lib/firestore';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-config';
import type { SiteConfig } from '@/types';

export function useSiteConfig() {
    const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeSiteConfig(
            (config) => {
                setSiteConfig(config);
                setLoading(false);
            },
            (error) => {
                console.error('Error subscribing site config:', error);
                setLoading(false);
            }
        );

        return unsubscribe;
    }, []);

    return { siteConfig, loading };
}
