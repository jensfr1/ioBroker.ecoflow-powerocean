/**
 * Manueller Live-Test gegen die echte Anlage (ohne ioBroker).
 *
 *   npx tsx test/live-check.ts <email> <passwort> <sn>
 *
 * Laeuft 40 Sekunden und zeigt die eingehenden Snapshots.
 */
import { EcoflowClient } from '../src/lib/ecoflow-client';
import type { Snapshot } from '../src/lib/snapshot';

const [email, password, deviceSn] = process.argv.slice(2);
if (!email || !password || !deviceSn) {
    console.error('Aufruf: npx tsx test/live-check.ts <email> <passwort> <sn>');
    process.exit(1);
}

let count = 0;
const client = new EcoflowClient({
    email,
    password,
    deviceSn,
    log: {
        debug: m => console.log(`[debug] ${m}`),
        info: m => console.log(`[info ] ${m}`),
        warn: m => console.log(`[warn ] ${m}`),
        error: m => console.log(`[error] ${m}`),
    },
    onConnectionChange: connected => console.log(`[conn ] connected=${connected}`),
    // Entwicklerskript ohne Adapter-Instanz - hier tun es die globalen Timer.
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: timer => clearInterval(timer as NodeJS.Timeout),
    onSnapshot: (s: Snapshot) => {
        count++;
        if (count % 5 !== 0) {
            return;
        } // nicht jede Nachricht ausgeben
        console.log(
            `#${count} PV=${fmt(s.pvPowerW)}W Batt=${fmt(s.batteryPowerW)}W SoC=${fmt(s.batterySoc)}% ` +
                `Netz=${fmt(s.gridPowerW)}W Haus=${fmt(s.housePowerW)}W WR=${fmt(s.inverterPowerW)}W | ` +
                `Phasen=${[...(['a', 'b', 'c'] as const)].map(k => fmt(s.phases[k]?.activePower ?? null)).join('/')} | ` +
                `Strings=${[...s.pvStrings.entries()].map(([i, w]) => `${i}:${fmt(w)}`).join(' ')} | ` +
                `Module=${[...s.batteryPacks.values()].map(p => `${p.packIndex}:${fmt(p.soc)}%`).join(' ')}`,
        );
    },
});

const fmt = (v: number | null): string => (v === null ? '-' : String(Math.round(v)));

void (async () => {
    await client.start();
    setTimeout(() => {
        void (async () => {
            console.log(`\nErgebnis: ${count} Snapshots empfangen`);
            await client.stop();
            console.log('Client sauber gestoppt (keine offenen Timer)');
            process.exit(count > 0 ? 0 : 2);
        })();
    }, 40_000);
})();
