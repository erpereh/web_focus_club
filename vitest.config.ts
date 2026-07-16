import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
        clearMocks: true,
        environment: 'jsdom',
        setupFiles: ['./src/vitest.setup.ts'],
        restoreMocks: true,
    },
});
