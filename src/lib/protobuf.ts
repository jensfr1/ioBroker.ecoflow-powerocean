/**
 * Protobuf-Decoder fuer EcoFlow-PowerOcean-MQTT-Nachrichten
 * (Topic /app/device/property/{SN}).
 *
 * Envelope: HeaderMessage { repeated Header header = 1 }
 * Header:   1=pdata, 6=enc_type (1 = XOR mit seq&0xFF), 8=cmd_func, 9=cmd_id, 14=seq
 * cmdFunc 96: cmdId 1 = EMS-Heartbeat (Phasen/MPPT), 7 = Batterie-Packs,
 *             33 = Energiefluss (Last/Netz/PV/Batterie/SoC)
 *
 * Feldnummern nach Reverse-Engineering aus foxthefox/ioBroker.ecoflow-mqtt und
 * Feberdin/ecoflow-powerocean-ha (beide MIT).
 */

type WireValue = number | bigint | Uint8Array;
type Fields = Map<number, WireValue[]>;

function readVarint(data: Uint8Array, pos: number): [number, number] {
    let result = 0;
    let shift = 0;
    while (pos < data.length) {
        const byte = data[pos];
        pos += 1;
        result += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) {
            break;
        }
        shift += 7;
    }
    return [result, pos];
}

function decodeFields(data: Uint8Array): Fields {
    const fields: Fields = new Map();
    let pos = 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    while (pos < data.length) {
        let tag: number;
        [tag, pos] = readVarint(data, pos);
        const fieldNum = tag >>> 3;
        const wireType = tag & 0x07;
        let value: WireValue;

        if (wireType === 0) {
            [value, pos] = readVarint(data, pos);
        } else if (wireType === 1) {
            if (pos + 8 > data.length) {
                break;
            }
            value = view.getFloat64(pos, true);
            pos += 8;
        } else if (wireType === 2) {
            let length: number;
            [length, pos] = readVarint(data, pos);
            if (pos + length > data.length) {
                break;
            }
            value = data.subarray(pos, pos + length);
            pos += length;
        } else if (wireType === 5) {
            if (pos + 4 > data.length) {
                break;
            }
            value = view.getFloat32(pos, true);
            pos += 4;
        } else {
            break;
        }
        const list = fields.get(fieldNum);
        if (list) {
            list.push(value);
        } else {
            fields.set(fieldNum, [value]);
        }
    }
    return fields;
}

const num = (f: Fields, n: number, fallback = 0): number => {
    const v = f.get(n)?.[0];
    return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : fallback;
};

const bytes = (f: Fields, n: number): Uint8Array => {
    const v = f.get(n)?.[0];
    return v instanceof Uint8Array ? v : new Uint8Array(0);
};

const xorDecrypt = (pdata: Uint8Array, seq: number): Uint8Array => {
    const key = seq & 0xff;
    return key === 0 ? pdata : pdata.map(b => b ^ key);
};

export interface DecodedPhase {
    vol: number;
    amp: number;
    actPwr: number;
    reactPwr: number;
    apparentPwr: number;
}

export interface DecodedPvString {
    vol: number;
    amp: number;
    pwr: number;
}

export interface DecodedEmsHeartbeat {
    pcsAPhase: DecodedPhase;
    pcsBPhase: DecodedPhase;
    pcsCPhase: DecodedPhase;
    frequencyHz: number;
    pvStrings: DecodedPvString[];
    emsBpPower: number;
    bpRemainWh: number;
    bpAliveNum: number;
}

export interface DecodedBatteryPack {
    packIndex: number;
    sn: string;
    soc: number;
    realSoc: number;
    soh: number;
    pwr: number;
    vol: number;
    amp: number;
    remainWh: number;
    cycles: number;
    tempEnv: number;
    tempMos: number;
    charging: boolean;
}

export interface DecodedEnergyStream {
    sysLoadPwr: number;
    sysGridPwr: number;
    mpptPwr: number;
    bpPwr: number;
    bpSoc: number;
}

/** Telemetrie der neuen PowerOcean-Generation (cmdFunc 254, cmdId 39). */
export interface DecodedPo2Telemetry {
    pvPowerW: number | null;
    gridPowerW: number | null;
    /** Vorlaeufig Feld 65.7 — bei aktiver Batterie verifizieren. */
    batteryPowerW: number | null;
    socPercent: number | null;
    remainingWh: number | null;
    /** Gesamtleistung des PCS-Blocks (Feld 4.1). */
    pcsTotalW: number | null;
    /** Delta-kodierte Phasenwerte, Index 1-3. */
    phases: Map<number, Partial<DecodedPhase>>;
    /** PV-String-Leistungen, Index -> Watt. */
    pvStrings: Map<number, number>;
}

/** Batterie-Pack-Report der neuen Generation (cmdFunc 254, cmdId 46). */
export interface DecodedPo2BatteryPack {
    packIndex: number;
    sn: string;
    socPercent: number;
    realSoc: number;
    fullCapacityWh: number;
    tempC: number;
    voltageV: number;
    /** Modul-Leistung in W: positiv = laden, negativ = entladen. */
    powerW: number;
    /** Alterungszustand in %. */
    sohPercent: number;
    /** Bisherige Vollzyklen. */
    cycles: number;
}

export interface DecodedMessage {
    energyStream?: DecodedEnergyStream;
    emsHeartbeat?: DecodedEmsHeartbeat;
    batteryPacks: DecodedBatteryPack[];
    po2Telemetry?: DecodedPo2Telemetry;
    po2BatteryPacks: DecodedPo2BatteryPack[];
}

function decodePhase(raw: Uint8Array): DecodedPhase {
    const f = decodeFields(raw);
    return {
        vol: num(f, 1),
        amp: num(f, 2),
        actPwr: num(f, 3),
        reactPwr: num(f, 4),
        apparentPwr: num(f, 5),
    };
}

function decodeEmsHeartbeat(pdata: Uint8Array): DecodedEmsHeartbeat {
    const f = decodeFields(pdata);
    const pvStrings: DecodedPvString[] = [];
    for (const entryRaw of f.get(31) ?? []) {
        if (!(entryRaw instanceof Uint8Array)) {
            continue;
        }
        const entry = decodeFields(entryRaw);
        for (const pvRaw of entry.get(1) ?? []) {
            if (!(pvRaw instanceof Uint8Array)) {
                continue;
            }
            const pv = decodeFields(pvRaw);
            pvStrings.push({ vol: num(pv, 1), amp: num(pv, 2), pwr: num(pv, 3) });
        }
    }
    let frequencyHz = 0;
    const loadInfo = bytes(f, 15);
    if (loadInfo.length > 0) {
        frequencyHz = num(decodeFields(loadInfo), 3);
    }
    return {
        pcsAPhase: f.get(12) ? decodePhase(bytes(f, 12)) : { vol: 0, amp: 0, actPwr: 0, reactPwr: 0, apparentPwr: 0 },
        pcsBPhase: f.get(13) ? decodePhase(bytes(f, 13)) : { vol: 0, amp: 0, actPwr: 0, reactPwr: 0, apparentPwr: 0 },
        pcsCPhase: f.get(14) ? decodePhase(bytes(f, 14)) : { vol: 0, amp: 0, actPwr: 0, reactPwr: 0, apparentPwr: 0 },
        frequencyHz,
        pvStrings,
        emsBpPower: num(f, 59),
        bpRemainWh: num(f, 1),
        bpAliveNum: num(f, 58),
    };
}

function decodeBatteryPacks(pdata: Uint8Array): DecodedBatteryPack[] {
    const outer = decodeFields(pdata);
    const packs: DecodedBatteryPack[] = [];
    for (const packRaw of outer.get(1) ?? []) {
        if (!(packRaw instanceof Uint8Array)) {
            continue;
        }
        const f = decodeFields(packRaw);
        const snB64 = Buffer.from(bytes(f, 16)).toString('utf8');
        let sn = snB64;
        try {
            const decoded = Buffer.from(snB64, 'base64').toString('utf8');
            if (/^[\x20-\x7e]+$/.test(decoded) && decoded.length > 4) {
                sn = decoded;
            }
        } catch {
            /* Klartext-SN behalten */
        }
        const pack: DecodedBatteryPack = {
            packIndex: num(f, 15),
            sn,
            soc: num(f, 2),
            realSoc: num(f, 38),
            soh: num(f, 3),
            pwr: num(f, 1),
            vol: num(f, 9),
            amp: num(f, 10),
            remainWh: num(f, 54),
            cycles: num(f, 17),
            tempEnv: num(f, 25),
            tempMos: num(f, 19),
            charging: num(f, 50) === 1,
        };
        if (pack.packIndex > 0) {
            packs.push(pack);
        }
    }
    return packs;
}

function decodeEnergyStream(pdata: Uint8Array): DecodedEnergyStream {
    const f = decodeFields(pdata);
    return {
        sysLoadPwr: num(f, 1),
        sysGridPwr: num(f, 2),
        mpptPwr: num(f, 3),
        bpPwr: num(f, 4),
        bpSoc: num(f, 5),
    };
}

function decodePo2Telemetry(pdata: Uint8Array): DecodedPo2Telemetry {
    const f = decodeFields(pdata);
    const result: DecodedPo2Telemetry = {
        pvPowerW: null,
        gridPowerW: null,
        batteryPowerW: null,
        socPercent: null,
        remainingWh: null,
        pcsTotalW: null,
        phases: new Map(),
        pvStrings: new Map(),
    };

    // Feld 65 = Systemzusammenfassung: 4=PV, 7=Netz (~0 bei Nulleinspeisung, pos=Bezug),
    // 15/18=verbleibende Energie Wh, 17=System-SoC, 20=Batterieleistung (Betrag).
    // ACHTUNG: 65.6 ist NICHT der Netzzaehler, sondern der WR-Ausgang (mirror von 65.5)!
    const summary = f.get(65)?.[0];
    if (summary instanceof Uint8Array) {
        const s = decodeFields(summary);
        result.pvPowerW = num(s, 4);
        // 65.7 war frueher als Netzleistung eingeordnet - falsch, siehe 4.13.
        result.socPercent = num(s, 17);
        result.remainingWh = num(s, 15);
        // 65.20 = Batterie-Betrag: exakt 0 = idle (Feld 7.4 fehlt dann in den anderen
        // Nachrichten, daher hier explizit auf 0 setzen; Vorzeichen kommt aus 7.4).
        if (num(s, 20) === 0) {
            result.batteryPowerW = 0;
        }
    }

    // Feld 7 (bzw. 87) = Erzeugungs-Zusammenfassung: 1=Gesamt, 3=PV,
    // 4=Batterieleistung (signiert: negativ = Entladen, positiv = Laden)
    const gen = f.get(7)?.[0] ?? f.get(87)?.[0];
    if (gen instanceof Uint8Array) {
        const g = decodeFields(gen);
        // Nur setzen, wenn das Feld wirklich vorhanden ist — sonst wuerde ein
        // fehlendes Feld den guten Wert mit 0 ueberschreiben.
        if ((result.pvPowerW === null || result.pvPowerW === 0) && g.has(3)) {
            result.pvPowerW = num(g, 3);
        }
        if (g.has(4)) {
            result.batteryPowerW = num(g, 4);
        }
    }

    // Feld 4 = PCS-Block: 1=Gesamtleistung, 3.1=Phasen (delta-kodiert), 14.1=PV-Strings
    const pcs = f.get(4)?.[0];
    if (pcs instanceof Uint8Array) {
        const p = decodeFields(pcs);
        if (p.has(1)) {
            result.pcsTotalW = num(p, 1);
        }
        /*
         * 4.13 ist die Netzleistung (positiv = Bezug, negativ = Einspeisung).
         *
         * Nachgewiesen am 27.07.2026: Beim Laden der Batterie aus dem Netz
         * stand hier 1719 W, waehrend der Wechselrichter (4.1) mit -1530 W zog
         * und das Haus rund 190 W brauchte - die Summe geht auf. Mit dem Ende
         * der Ladung fiel der Wert binnen Sekunden auf 0.
         *
         * Frueher stand hier Feld 65.7. Das ist eine Einstellung, keine
         * Messung: An einer Anlage mit Nulleinspeisung steht es dauerhaft auf
         * 0, an einer mit 10-kW-Begrenzung meldete es konstant 10000.
         */
        if (p.has(13)) {
            result.gridPowerW = num(p, 13);
        }
        const phaseBlock = p.get(3)?.[0];
        if (phaseBlock instanceof Uint8Array) {
            for (const entryRaw of decodeFields(phaseBlock).get(1) ?? []) {
                if (!(entryRaw instanceof Uint8Array)) {
                    continue;
                }
                const e = decodeFields(entryRaw);
                const idx = num(e, 6);
                if (idx < 1 || idx > 3) {
                    continue;
                }
                const phase: Partial<DecodedPhase> = {};
                if (e.has(1)) {
                    phase.vol = num(e, 1);
                }
                if (e.has(2)) {
                    phase.amp = num(e, 2);
                }
                if (e.has(3)) {
                    phase.actPwr = num(e, 3);
                }
                if (e.has(4)) {
                    phase.reactPwr = num(e, 4);
                }
                if (e.has(5)) {
                    phase.apparentPwr = num(e, 5);
                }
                result.phases.set(idx, phase);
            }
        }
        const pvBlock = p.get(14)?.[0];
        if (pvBlock instanceof Uint8Array) {
            for (const entryRaw of decodeFields(pvBlock).get(1) ?? []) {
                if (!(entryRaw instanceof Uint8Array)) {
                    continue;
                }
                const e = decodeFields(entryRaw);
                const idx = num(e, 1);
                if (idx >= 1 && e.has(4)) {
                    result.pvStrings.set(idx, num(e, 4));
                }
            }
        }
    }

    return result;
}

function decodePo2BatteryPack(pdata: Uint8Array): DecodedPo2BatteryPack | null {
    const f = decodeFields(pdata);
    const pack = f.get(5)?.[0];
    if (!(pack instanceof Uint8Array)) {
        return null;
    }
    const p = decodeFields(pack);
    const sn = Buffer.from(bytes(p, 16)).toString('utf8');
    const packIndex = num(p, 15);
    if (packIndex < 1) {
        return null;
    }
    return {
        packIndex,
        sn,
        socPercent: num(p, 39),
        realSoc: num(p, 38),
        fullCapacityWh: num(p, 54),
        tempC: num(p, 21),
        voltageV: num(p, 6) / 10,
        // 1/3/17 tragen dieselbe Bedeutung wie bei der aelteren Generation -
        // geprueft am 28.07.2026: 1122,59 W / 100 % / 4 Zyklen an einem vier
        // Wochen alten System.
        powerW: num(p, 1),
        sohPercent: num(p, 3),
        cycles: num(p, 17),
    };
}

/**
 * Dekodiert eine rohe MQTT-Payload vom Topic /app/device/property/{SN}.
 */
export function decodeMqttPayload(raw: Uint8Array): DecodedMessage {
    const result: DecodedMessage = { batteryPacks: [], po2BatteryPacks: [] };
    const outer = decodeFields(raw);
    for (const headerRaw of outer.get(1) ?? []) {
        if (!(headerRaw instanceof Uint8Array)) {
            continue;
        }
        const h = decodeFields(headerRaw);
        const cmdFunc = num(h, 8);
        const cmdId = num(h, 9);
        const encType = num(h, 6);
        const seq = num(h, 14);
        let pdata = bytes(h, 1);
        if (pdata.length === 0) {
            continue;
        }
        if (encType === 1) {
            pdata = xorDecrypt(pdata, seq);
        }
        if (cmdFunc === 96 && cmdId === 1) {
            result.emsHeartbeat = decodeEmsHeartbeat(pdata);
        } else if (cmdFunc === 96 && cmdId === 7) {
            result.batteryPacks.push(...decodeBatteryPacks(pdata));
        } else if (cmdFunc === 96 && cmdId === 33) {
            result.energyStream = decodeEnergyStream(pdata);
        } else if (cmdFunc === 254 && cmdId === 39) {
            result.po2Telemetry = decodePo2Telemetry(pdata);
        } else if (cmdFunc === 254 && cmdId === 46) {
            const pack = decodePo2BatteryPack(pdata);
            if (pack) {
                result.po2BatteryPacks.push(pack);
            }
        }
    }
    return result;
}
