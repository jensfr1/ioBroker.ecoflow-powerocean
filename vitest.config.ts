import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        /*
         * Nur die TypeScript-Tests. test/package.test.js und
         * test/integration.js laufen unter mocha (kommt aus @iobroker/testing)
         * und kennen die Globalen von vitest nicht - ohne diese Einschraenkung
         * zieht vitest sie ueber sein Standardmuster *.test.js mit hinein und
         * scheitert an "describe is not defined".
         */
        include: ['test/**/*.test.ts'],
    },
});
