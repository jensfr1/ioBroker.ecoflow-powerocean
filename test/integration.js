/*
 * Integrationstest: startet einen echten js-controller samt Adapter und prueft,
 * dass der Adapter hochkommt und sich wieder sauber beenden laesst.
 *
 * Ohne Zugangsdaten kommt keine Verbindung zustande - das ist hier auch nicht
 * das Ziel. Geprueft wird der Lebenszyklus: Objektbaum anlegen, starten,
 * entladen. Genau dort waere der Timer-Fehler aufgefallen, der die Instanz
 * sonst am Beenden gehindert haette.
 */
const path = require('node:path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'));
