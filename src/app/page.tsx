import { getSiteContent, getServices, getApprovedTestimonials } from '@/lib/firestore';
import { defaultCMS } from '@/hooks/useFirestore';
import HomeClient from './HomeClient';

export default async function Home() {
  const [cmsContent, services, testimonials] = await Promise.all([
    getSiteContent().catch(() => null),
    getServices().catch(() => []),
    getApprovedTestimonials().catch(() => []),
  ]);

  return (
    <HomeClient
      initialCMS={cmsContent ?? defaultCMS}
      initialServices={services}
      initialTestimonials={testimonials}
    />
  );
}
