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
        expect(t.batteryPowerW).toBe(0);
        // Diese Aufzeichnung hat keinen Wechselrichter-Block, also kein Feld
        // 4.13 - und damit keinen Netzwert. Frueher stand hier 65.7 und lieferte
        // 0; das sah plausibel aus, ist aber eine Einstellung, keine Messung.
        expect(t.gridPowerW).toBeNull();
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

describe('Hauslast (Feld 7.1/87.1)', () => {
    /*
     * Aufgezeichnet am 28.07.2026 an einer dreiphasigen Anlage mit zwei
     * Modulen (Seriennummern anonymisiert). Der Frame belegt, warum die
     * Hauslast gemessen und nicht gerechnet gehoert: Block 87 meldet 490 W und
     * bilanziert sauber (PV 2570 - Batterie 310 - Einspeisung 1770 = 490),
     * waehrend Wechselrichter plus Netz aus Block 4 nur 306 W ergeben - diese
     * beiden Felder stammen aus verschiedenen Momenten.
     *
     * Der Frame traegt Block 7 und Block 87 gleichzeitig mit leicht
     * abweichenden Werten. Block 87 gewinnt; die App zeigte dessen Zahlen.
     */
    const HOUSE_HEX =
        '0af6010a9b01225a0d73060e451a390a111dad563744258eebe2422d1485394430010a111d077f374425a695c7422d352f394430020a111dd60b374425b929cf422d6ede384430032d426557446d3bccf5c4720e0a0c0802157b62c84325e079bc443a14150000e1c41d00e021452500009b433500e0214582040a0d224599431504bcb745ba05190d0000f543150040ddc41d00a020452500009b433500a020451060182020012801380340fe014827509b01580170d3d5be0578fe01800104c2011052453131585858585858585858585858ca011052453131585858585858585858585858d2011052453131585858585858585858585858';

    it('nimmt die gemeldete Hauslast, nicht die Rechnung aus Block 4', () => {
        const t = decodeMqttPayload(hexToBytes(HOUSE_HEX)).po2Telemetry!;
        expect(t.housePowerW).toBe(490);
        // Was die alte Rechnung ergeben haette - deutlich daneben
        expect(Math.round(t.pcsTotalW! + t.gridPowerW!)).toBe(306);
    });

    it('bilanziert mit PV, Batterie und Netz', () => {
        const t = decodeMqttPayload(hexToBytes(HOUSE_HEX)).po2Telemetry!;
        expect(t.pvPowerW).toBe(2570);
        expect(t.batteryPowerW).toBe(310);
        expect(t.pvPowerW! - t.batteryPowerW! - 1770).toBe(t.housePowerW);
    });

    it('bevorzugt Feld 4.13 als Netzleistung gegenueber 7.2', () => {
        const t = decodeMqttPayload(hexToBytes(HOUSE_HEX)).po2Telemetry!;
        expect(t.gridPowerW).toBeCloseTo(-1966.4, 1);
    });
});

/*
 * Batteriemodul (cmdFunc 254, cmdId 46), aufgezeichnet am 01.08.2026 waehrend
 * einer Wallbox-Ladung, Seriennummern anonymisiert. Das Modul entlud mit
 * 2664 W - deshalb liegt die Leistungselektronik 25 K ueber den Zellen.
 *
 * Die Temperaturzuordnung stammt aus einem Lastversuch ueber 45 Minuten.
 * Entscheidend war die Dynamik, nicht der Absolutwert: Bei einer sich
 * insgesamt aufheizenden Anlage korreliert jeder traege Sensor zufaellig mit
 * der Last, weshalb ein blosser Mittelwertvergleich neun von zehn Feldern
 * faelschlich als Leistungselektronik ausweist.
 */
const PACK_HEX =
    '0a9b030aee02081e2ae9020d8e8126c5102f18642a14000024420000204200001c420000184200001c4235007049453d0000494540014d9a997f415578e128c35dbd73404965229a22c86800721400704945004049450030494500004945000049457801820110524531325858585858585858585858588801069001009d0100a0be45a50100e0c445ad0100001842b50100006042bd0100006c42c50100007042cd0100006842d001ab838001d80199d67ee001909513e8019e9413f50100002442fd0100001842850200007c428d02000074429002009802ffff03a00221a80291d4b6d306b50246a04342bd020000c842c00200c80205d00264d80201e00200e80283d001f00201f802a0828408800385808408880302900301980301a003c4c209a803c09710b503c3931645bd03740c4042c50300000000cd0346a04342d50346a04342dd033033dc3fe5035db9c742ed039af1c742f00300f8030080040088048a95029004d78802a00402ad040050494510601820200140fe01482e50ee0278fe01800103880101c2011052453131585858585858585858585858';

describe('Batteriemodul (cmdId 46)', () => {
    const pack = decodeMqttPayload(hexToBytes(PACK_HEX)).po2BatteryPacks[0];

    it('liest Ladestand, Leistung und Zyklen', () => {
        expect(pack.packIndex).toBe(1);
        expect(pack.socPercent).toBeCloseTo(48.9, 1);
        expect(pack.powerW).toBeCloseTo(-2664.1, 1);
        expect(pack.cycles).toBe(6);
    });

    it('liest Packspannung und Strom, die zur Leistung passen', () => {
        expect(pack.voltageV).toBeCloseTo(15.98, 2);
        expect(pack.currentA).toBeCloseTo(-168.88, 2);
        // Spannung mal Strom trifft die gemeldete Leistung auf wenige Prozent
        expect(pack.voltageV * pack.currentA).toBeCloseTo(pack.powerW, -2);
    });

    it('bestaetigt den 5S-Aufbau', () => {
        // 16 V Packspannung wirken fuer einen Hausspeicher unplausibel - bis man
        // durch die Zellspannung teilt und genau 5 Zellen in Reihe herauskommen.
        expect(pack.voltageV / pack.cellVoltageV).toBeCloseTo(5, 0);
    });

    it('trennt Zelltemperatur von Leistungselektronik', () => {
        expect(pack.tempC).toBe(38);
        expect(pack.tempMinCellC).toBe(38);
        expect(pack.tempMaxCellC).toBe(41);
        // Waermster der vier Halbleiter-Sensoren (59/60/63/61)
        expect(pack.tempMosC).toBe(63);
    });

    it('haelt die Reihenfolge min <= mittel <= max ein', () => {
        // Gilt in beiden Modulen ueber beide Messreihen - das ist der Grund, die
        // Felder 31/21/30 als min/mittel/max zu lesen.
        expect(pack.tempMinCellC).toBeLessThanOrEqual(pack.tempC);
        expect(pack.tempC).toBeLessThanOrEqual(pack.tempMaxCellC);
    });

    it('haelt die Elektronik deutlich ueber den Zellen', () => {
        expect(pack.tempMosC).toBeGreaterThan(pack.tempMaxCellC);
    });
});
