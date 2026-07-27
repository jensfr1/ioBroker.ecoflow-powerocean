import { describe, expect, it } from 'vitest';
import { decodeMqttPayload } from '../src/lib/protobuf';

/**
 * Echte Payloads, aufgezeichnet vom Topic /app/device/property/RE11XXXXXXXXXXXX
 * (PowerOcean, neue Generation, 2026-07-25). Beide sind cmdFunc 254 / cmdId 39,
 * aber unterschiedliche Untertypen - genau darum geht es beim Merge:
 *   PCS_BLOCK: Feld 4 (Wechselrichter) -> Phasen + PV-Strings, delta-kodiert
 *   SUMMARY:   Feld 65 (Systemzusammenfassung) -> PV/Netz/Batterie/SoC
 */
const PCS_BLOCK_HEX =
    '0ad6010a7e22590d78a085441a390a111d183aab4325fe59cb422d529db24330010a111db8fcad4325e2c6b4422dd8c2b34330020a111d67e8b2432583b8b7422da0b5b84330036dc0cee24172120a07080125df9209440a070802255f6a18443a0f0d00408d441d00408d443500408d44ba050f0d00408d441d00408d443500408d441060182020012801380340fe014827507e580170caa24478fe01800104c2011052453131585858585858585858585858ca011052453131585858585858585858585858d2011052453131585858585858585858585858';

const SUMMARY_HEX =
    '0ac2010a6a3a0f0d00808e441d00808e443500808e448a04440800100018002500e08c442d00807f4435004081c43d000000004000480055000000005d0000000060006802700278c04e80010a8801649001c04e980101a50100000000ba050f0d00c08f441d00c08f443500c08f441060182020012801380340fe014827506a580170ada24478fe01800104c2011052453131585858585858585858585858ca011052453131585858585858585858585858d2011052453131585858585858585858585858';

const hexToBytes = (hex: string): Uint8Array => new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));

const round = (n: number | null | undefined): number | null => (n === null || n === undefined ? null : Math.round(n));

describe('decodeMqttPayload — Systemzusammenfassung (Feld 65)', () => {
    const msg = decodeMqttPayload(hexToBytes(SUMMARY_HEX));

    it('erkennt die Nachricht als PowerOcean-Telemetrie', () => {
        expect(msg.po2Telemetry).toBeDefined();
    });

    it('liest PV, Netz, Batterie und SoC', () => {
        const t = msg.po2Telemetry!;
        expect(round(t.pvPowerW)).toBe(1127);
        // Anlage mit Nulleinspeisung: Netz und Batterie stehen auf 0
        expect(t.gridPowerW).toBe(0);
        expect(t.batteryPowerW).toBe(0);
        expect(t.socPercent).toBe(100);
    });

    it('liest die verbleibende Akku-Energie (10 kWh Speicher)', () => {
        expect(msg.po2Telemetry!.remainingWh).toBe(10048);
    });
});

describe('decodeMqttPayload — Wechselrichter-Block (Feld 4)', () => {
    const msg = decodeMqttPayload(hexToBytes(PCS_BLOCK_HEX));

    it('liest die PV-Leistung und die Wechselrichter-Gesamtleistung', () => {
        const t = msg.po2Telemetry!;
        expect(round(t.pvPowerW)).toBe(1130);
        expect(round(t.pcsTotalW)).toBe(1069);
    });

    it('liest alle drei Phasen', () => {
        const phases = msg.po2Telemetry!.phases;
        expect([...phases.keys()].sort()).toEqual([1, 2, 3]);
        expect(round(phases.get(1)!.actPwr)).toBe(342);
        expect(round(phases.get(2)!.actPwr)).toBe(348);
        expect(round(phases.get(3)!.actPwr)).toBe(358);
    });

    it('liefert Phasen delta-kodiert (nur uebertragene Felder)', () => {
        // In dieser Nachricht fehlen Spannung und Strom bewusst - der Merge muss
        // deshalb die Vorwerte behalten und darf nicht auf 0 zuruecksetzen.
        const phaseA = msg.po2Telemetry!.phases.get(1)!;
        expect(phaseA.actPwr).toBeDefined();
        expect(phaseA.vol).toBeUndefined();
        expect(phaseA.amp).toBeUndefined();
    });

    it('liest die einzelnen PV-Strings', () => {
        const strings = msg.po2Telemetry!.pvStrings;
        expect(round(strings.get(1))).toBe(550);
        expect(round(strings.get(2))).toBe(610);
    });
});

describe('decodeMqttPayload — Robustheit', () => {
    it('wirft bei leerer Payload nicht', () => {
        expect(() => decodeMqttPayload(new Uint8Array(0))).not.toThrow();
    });

    it('wirft bei abgeschnittener Payload nicht', () => {
        const truncated = hexToBytes(SUMMARY_HEX).subarray(0, 40);
        expect(() => decodeMqttPayload(truncated)).not.toThrow();
    });

    it('wirft bei Zufallsdaten nicht', () => {
        const noise = new Uint8Array(64).map((_, i) => (i * 37) % 256);
        expect(() => decodeMqttPayload(noise)).not.toThrow();
    });
});
