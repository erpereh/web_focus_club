'use client';

import { useEffect, useState } from 'react';
import { subscribeSiteConfig } from '@/lib/firestore';
import type { SiteConfig } from '@/types';

const DEFAULT_SITE_CONFIG: SiteConfig = {
    startHour: 8,
    endHour: 20,
    slotInterval: 30,
    bonoExpirationMonths: 1,
    maintenanceMode: false,
};

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
