import { describe, expect, it } from 'vitest';
import { decodeMqttPayload } from '../src/lib/protobuf';
import {
  mergeSnapshot,
  emptySnapshot,
  computeHouseLoad,
  hasPayload,
  sumPhases,
  averagePhases,
} from '../src/lib/snapshot';
import type { DecodedMessage } from '../src/lib/protobuf';

const SN = 'RE11XXXXXXXXXXXX';

/**
 * Baut eine leere DecodedMessage und ergaenzt gezielt Felder.
 */
const message = (partial: Partial<DecodedMessage> = {}): DecodedMessage => ({
  batteryPacks: [],
  po2BatteryPacks: [],
  ...partial,
});

const telemetry = (partial: Partial<NonNullable<DecodedMessage['po2Telemetry']>> = {}) => ({
  pvPowerW: null,
  gridPowerW: null,
  batteryPowerW: null,
  socPercent: null,
  remainingWh: null,
  pcsTotalW: null,
  phases: new Map(),
  pvStrings: new Map(),
  ...partial,
});

describe('mergeSnapshot — Delta-Kodierung der Phasen', () => {
  it('behaelt Vorwerte, wenn Felder fehlen', () => {
    // 1. Nachricht: vollstaendige Phase A
    const first = mergeSnapshot(
      SN,
      null,
      message({
        po2Telemetry: telemetry({
          phases: new Map([[1, { vol: 235, amp: 1.2, actPwr: 280 }]]),
        }),
      }),
    );
    expect(first.phases.a).toMatchObject({ voltage: 235, current: 1.2, activePower: 280 });

    // 2. Nachricht: nur noch die Wirkleistung
    const second = mergeSnapshot(
      SN,
      first,
      message({ po2Telemetry: telemetry({ phases: new Map([[1, { actPwr: 310 }]]) }) }),
    );
    expect(second.phases.a).toMatchObject({
      voltage: 235, // erhalten geblieben
      current: 1.2, // erhalten geblieben
      activePower: 310, // aktualisiert
    });
  });

  it('laesst nie uebertragene Felder null (statt 0 zu erfinden)', () => {
    // Nachts sendet das Geraet oft nur die Wirkleistung. Ein 0-Wert fuer die
    // Spannung waere eine erfundene Messung - der State darf dann gar nicht
    // erst geschrieben werden.
    const s = mergeSnapshot(
      SN,
      null,
      message({ po2Telemetry: telemetry({ phases: new Map([[1, { actPwr: 86 }]]) }) }),
    );
    expect(s.phases.a!.activePower).toBe(86);
    expect(s.phases.a!.voltage).toBeNull();
    expect(s.phases.a!.current).toBeNull();
  });

  it('veraendert den Vorzustand nicht (kein Seiteneffekt)', () => {
    const first = mergeSnapshot(
      SN,
      null,
      message({ po2Telemetry: telemetry({ phases: new Map([[1, { actPwr: 100 }]]) }) }),
    );
    mergeSnapshot(
      SN,
      first,
      message({ po2Telemetry: telemetry({ phases: new Map([[1, { actPwr: 999 }]]) }) }),
    );
    expect(first.phases.a!.activePower).toBe(100);
  });
});

describe('mergeSnapshot — PV-Strings und Batterie-Module', () => {
  it('mergt PV-Strings inkrementell statt zu ersetzen', () => {
    const first = mergeSnapshot(
      SN,
      null,
      message({ po2Telemetry: telemetry({ pvStrings: new Map([[1, 500]]) }) }),
    );
    const second = mergeSnapshot(
      SN,
      first,
      message({ po2Telemetry: telemetry({ pvStrings: new Map([[2, 600]]) }) }),
    );
    expect([...second.pvStrings.entries()].sort()).toEqual([
      [1, 500],
      [2, 600],
    ]);
  });

  it('mergt Batterie-Module ueber den Pack-Index', () => {
    const pack = (packIndex: number, realSoc: number) => ({
      packIndex,
      sn: `PACK${packIndex}`,
      socPercent: 100,
      realSoc,
      fullCapacityWh: 5024,
      tempC: 38,
      voltageV: 325.8,
    });
    const first = mergeSnapshot(SN, null, message({ po2BatteryPacks: [pack(1, 99.1)] }));
    const second = mergeSnapshot(SN, first, message({ po2BatteryPacks: [pack(2, 98.7)] }));
    expect(second.batteryPacks.size).toBe(2);
    expect(second.batteryPacks.get(1)!.soc).toBeCloseTo(99.1);
    expect(second.batteryPacks.get(2)!.sn).toBe('PACK2');

    // Update desselben Moduls ersetzt, legt nicht doppelt an
    const third = mergeSnapshot(SN, second, message({ po2BatteryPacks: [pack(1, 95)] }));
    expect(third.batteryPacks.size).toBe(2);
    expect(third.batteryPacks.get(1)!.soc).toBe(95);
  });
});

describe('mergeSnapshot — Werte aus mehreren Nachrichtentypen', () => {
  it('setzt Werte nicht auf null zurueck, wenn sie in der Folgenachricht fehlen', () => {
    const withSoc = mergeSnapshot(
      SN,
      null,
      message({ po2Telemetry: telemetry({ socPercent: 98, gridPowerW: 0, pvPowerW: 1127 }) }),
    );
    // Folgenachricht enthaelt nur den Wechselrichter-Block
    const withPcs = mergeSnapshot(
      SN,
      withSoc,
      message({ po2Telemetry: telemetry({ pcsTotalW: 1069 }) }),
    );
    expect(withPcs.batterySoc).toBe(98);
    expect(withPcs.gridPowerW).toBe(0);
    expect(withPcs.inverterPowerW).toBe(1069);
  });

  it('ignoriert SoC 0 (kommt in Teilnachrichten als Platzhalter)', () => {
    const first = mergeSnapshot(SN, null, message({ po2Telemetry: telemetry({ socPercent: 87 }) }));
    const second = mergeSnapshot(
      SN,
      first,
      message({ po2Telemetry: telemetry({ socPercent: 0 }) }),
    );
    expect(second.batterySoc).toBe(87);
  });
});

describe('sumPhases / averagePhases', () => {
  const withPhases = (phases: Map<number, Record<string, number>>) =>
    mergeSnapshot(SN, null, message({ po2Telemetry: telemetry({ phases }) }));

  it('summiert die Wirkleistung ueber alle drei Phasen', () => {
    const s = withPhases(
      new Map([
        [1, { actPwr: 100 }],
        [2, { actPwr: 110 }],
        [3, { actPwr: 120 }],
      ]),
    );
    expect(sumPhases(s, 'activePower')).toBe(330);
  });

  it('liefert null, solange eine Phase den Wert noch nicht gemeldet hat', () => {
    // Teilsumme waere zu niedrig -> lieber gar nichts anzeigen
    const s = withPhases(
      new Map([
        [1, { actPwr: 100 }],
        [2, { actPwr: 110 }],
        [3, { reactPwr: 10 }], // Phase C ohne Wirkleistung
      ]),
    );
    expect(sumPhases(s, 'activePower')).toBeNull();
  });

  it('funktioniert auch bei einphasigen Anlagen', () => {
    const s = withPhases(new Map([[1, { actPwr: 1400 }]]));
    expect(sumPhases(s, 'activePower')).toBe(1400);
  });

  it('liefert null ohne jede Phase', () => {
    expect(sumPhases(emptySnapshot(SN), 'activePower')).toBeNull();
  });

  it('mittelt die Spannung statt sie zu summieren', () => {
    const s = withPhases(
      new Map([
        [1, { vol: 235 }],
        [2, { vol: 234 }],
        [3, { vol: 237 }],
      ]),
    );
    expect(averagePhases(s, 'voltage')).toBeCloseTo(235.33, 1);
  });
});

describe('computeHouseLoad', () => {
  it('rechnet Last = PV - Batterie + Netz', () => {
    const s = { ...emptySnapshot(SN), pvPowerW: 1500, batteryPowerW: -500, gridPowerW: 0 };
    // Akku entlaedt mit 500 W -> Last = 1500 + 500 = 2000
    expect(computeHouseLoad(s)).toBe(2000);
  });

  it('beruecksichtigt Netzbezug und Batterieladung', () => {
    const s = { ...emptySnapshot(SN), pvPowerW: 1000, batteryPowerW: 800, gridPowerW: 300 };
    // 1000 - 800 + 300 = 500
    expect(computeHouseLoad(s)).toBe(500);
  });

  it('wird nie negativ', () => {
    const s = { ...emptySnapshot(SN), pvPowerW: 100, batteryPowerW: 900, gridPowerW: 0 };
    expect(computeHouseLoad(s)).toBe(0);
  });

  it('liefert null ohne PV-Wert', () => {
    expect(computeHouseLoad(emptySnapshot(SN))).toBeNull();
  });
});

describe('mergeSnapshot — mit echten aufgezeichneten Payloads', () => {
  const SUMMARY_HEX =
    '0ac2010a6a3a0f0d00808e441d00808e443500808e448a04440800100018002500e08c442d00807f4435004081c43d000000004000480055000000005d0000000060006802700278c04e80010a8801649001c04e980101a50100000000ba050f0d00c08f441d00c08f443500c08f441060182020012801380340fe014827506a580170ada24478fe01800104c2011052453131585858585858585858585858ca011052453131585858585858585858585858d2011052453131585858585858585858585858';
  const hexToBytes = (hex: string) =>
    new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

  it('erzeugt einen plausiblen Snapshot', () => {
    const msg = decodeMqttPayload(hexToBytes(SUMMARY_HEX));
    expect(hasPayload(msg)).toBe(true);
    const s = mergeSnapshot(SN, null, msg, 1785000000000);
    expect(s.sn).toBe(SN);
    expect(s.updatedAt).toBe(1785000000000);
    expect(Math.round(s.pvPowerW!)).toBe(1127);
    expect(s.batterySoc).toBe(100);
    expect(s.batteryRemainingWh).toBe(10048);
    // Nulleinspeisung: PV deckt die Last, nichts ins Netz
    expect(s.gridPowerW).toBe(0);
    expect(s.housePowerW).toBe(1127);
  });
});

describe('hasPayload', () => {
  it('erkennt leere Nachrichten', () => {
    expect(hasPayload(message())).toBe(false);
  });
  it('erkennt Nachrichten mit Telemetrie', () => {
    expect(hasPayload(message({ po2Telemetry: telemetry({ pvPowerW: 1 }) }))).toBe(true);
  });
});
