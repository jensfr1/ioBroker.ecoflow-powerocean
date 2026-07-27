import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // build/ ist generiert, admin/ enthaelt nur JSON, node_modules ohnehin.
        ignores: ['build/**', 'admin/**', 'node_modules/**', '*.tgz'],
    },
    {
        rules: {
            /*
             * Die JSDoc-Regeln der Gemeinschaftskonfiguration verlangen einen
             * Doc-Block an *jedem* Export - auch an Interfaces, deren Feldnamen und
             * Typen bereits alles sagen. Ihr Autofix schreibt dafuer leere Bloecke
             * in den Code (in diesem Projekt waren es 325 Zeilen). Kommentiert wird
             * hier, wo etwas zu erklaeren ist, nicht auf Vorrat.
             */
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-description': 'off',
        },
    },
    {
        // Tests: Rueckgabetypen an Testfunktionen sind reines Rauschen.
        files: ['test/**/*.ts'],
        rules: {
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-use-before-define': 'off',
        },
    },
];
