/*
 * Prueft package.json und io-package.json auf Konsistenz (gleiche Version,
 * Pflichtfelder, gueltige Struktur). Kommt fertig aus @iobroker/testing und
 * wird von der Pruefung im Arbeitsablauf ueber "npm run test:package"
 * aufgerufen.
 */
const path = require('node:path');
const { tests } = require('@iobroker/testing');

tests.packageFiles(path.join(__dirname, '..'));
