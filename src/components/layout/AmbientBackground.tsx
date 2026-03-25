'use client';

export function AmbientBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10" aria-hidden="true">
      {/* Radial glow at top */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] opacity-80"
        style={{ background: 'var(--gradient-glow)' }}
      />
      {/* Grid texture */}
      <div
        className="absolute inset-0 opacity-100"
        style={{
          backgroundImage: `
            linear-gradient(rgba(82, 183, 136, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(82, 183, 136, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />
    </div>
  );
}
