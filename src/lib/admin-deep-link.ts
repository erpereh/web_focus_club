import type { Appointment } from '@/types';

/**
 * Direct links into the admin panel (`/admin?tab=…`), used by the statistics
 * page. The panel is a single client page with tabs, so the link is read once
 * on load. Unknown values are ignored instead of failing.
 */
export type AdminDeepLinkTab = 'appointments' | 'clients' | 'team' | 'availability';

export interface AdminDeepLink {
    tab?: AdminDeepLinkTab;
    status?: Appointment['status'];
    trainerId?: string;
    /** Prefills the client search in the clients tab. */
    clientQuery?: string;
}

const TABS: readonly AdminDeepLinkTab[] = ['appointments', 'clients', 'team', 'availability'];
const STATUSES: readonly Appointment['status'][] = ['pending', 'approved', 'rejected', 'cancelled'];

export function parseAdminDeepLink(search: string): AdminDeepLink {
    const params = new URLSearchParams(search);
    const tab = params.get('tab');
    const status = params.get('status');
    const trainer = params.get('trainer')?.trim();
    const query = params.get('q')?.trim();
    return {
        ...(tab && (TABS as readonly string[]).includes(tab) ? { tab: tab as AdminDeepLinkTab } : {}),
        ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as Appointment['status'] } : {}),
        ...(trainer && trainer.length <= 128 ? { trainerId: trainer } : {}),
        ...(query && query.length <= 120 ? { clientQuery: query } : {}),
    };
}

export function buildAdminDeepLink(link: AdminDeepLink): string {
    const params = new URLSearchParams();
    if (link.tab) params.set('tab', link.tab);
    if (link.status) params.set('status', link.status);
    if (link.trainerId) params.set('trainer', link.trainerId);
    if (link.clientQuery) params.set('q', link.clientQuery);
    const query = params.toString();
    return query ? `/admin?${query}` : '/admin';
}
