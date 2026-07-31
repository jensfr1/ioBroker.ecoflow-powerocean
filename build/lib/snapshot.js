"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySnapshot = emptySnapshot;
exports.computeHouseLoad = computeHouseLoad;
exports.mergeSnapshot = mergeSnapshot;
exports.sumPhases = sumPhases;
exports.averagePhases = averagePhases;
exports.hasPayload = hasPayload;
function emptySnapshot(sn) {
    return {
        sn,
        updatedAt: 0,
        pvPowerW: null,
        batteryPowerW: null,
        batterySoc: null,
        batteryRemainingWh: null,
        gridPowerW: null,
        inverterPowerW: null,
        housePowerW: null,
        housePowerMeasured: false,
        phases: { a: null, b: null, c: null },
        pvStrings: new Map(),
        batteryPacks: new Map(),
    };
}
const EMPTY_PHASE = {
    voltage: null,
    current: null,
    activePower: null,
    reactivePower: null,
    apparentPower: null,
};
/**
 * Uebernimmt nur die tatsaechlich uebertragenen Felder (Delta-Kodierung).
 */
function mergePhase(previous, partial) {
    const base = previous ?? { ...EMPTY_PHASE };
    return {
        voltage: partial.vol ?? base.voltage,
        current: partial.amp ?? base.current,
        activePower: partial.actPwr ?? base.activePower,
        reactivePower: partial.reactPwr ?? base.reactivePower,
        apparentPower: partial.apparentPwr ?? base.apparentPower,
    };
}
/**
 * Vollstaendige Phase (alter Nachrichtentyp cmdFunc 96) uebernehmen.
 */
function fullPhase(p) {
    return {
        voltage: p.vol,
        current: p.amp,
        activePower: p.actPwr,
        reactivePower: p.reactPwr,
        apparentPower: p.apparentPwr,
    };
}
/**
 * Totzone um null, wie sie EcoFlow selbst anwendet.
 *
 * Der Zaehler misst auch im Leerlauf ein paar Watt in die eine oder andere
 * Richtung. Im Portal und in der App taucht das nie auf: Deren Verlaufsexport
 * enthaelt ausschliesslich 0 oder Betraege ab 30 W. Ohne diese Schwelle steht
 * im Objektbaum "7 W Bezug", waehrend die App daneben 0 W zeigt.
 */
const GRID_DEADBAND_W = 30;
function applyGridDeadband(watt) {
    return Math.abs(watt) < GRID_DEADBAND_W ? 0 : watt;
}
/**
 * Hauslast berechnen - nur als Rueckfallebene.
 *
 * Das Geraet meldet die Hauslast selbst (Feld 7.1/87.1), und dieser Wert ist
 * dem hier berechneten vorzuziehen: Er stammt aus demselben Moment wie PV,
 * Batterie und Netz und bilanziert exakt mit ihnen.
 *
 * Die Rechnung hier addiert die beiden Quellen am Hausknoten - den
 * Wechselrichter-Ausgang und den Netzbezug. Sie liegt systematisch zu niedrig,
 * weil die Felder 4.1 und 4.13 unabhaengig voneinander aktualisiert werden und
 * damit aus verschiedenen Momenten stammen. Am 29.07.2026 standen so 2018 W
 * gerechnet gegen 2100 W gemeldet, im Log einer anderen Anlage 306 W gegen
 * 490 W.
 *
 * Fehlt auch der Wechselrichterwert, greift die Bilanz PV - Batterie + Netz.
 */
function computeHouseLoad(s) {
    if (s.inverterPowerW !== null && s.gridPowerW !== null) {
        return Math.max(0, Math.round(s.inverterPowerW + s.gridPowerW));
    }
    if (s.pvPowerW === null) {
        return null;
    }
    return Math.max(0, Math.round(s.pvPowerW - (s.batteryPowerW ?? 0) + (s.gridPowerW ?? 0)));
}
/**
 * Fuehrt eine dekodierte Nachricht in den Vorzustand ein und gibt den neuen
 * Gesamtzustand zurueck. `previous` wird dabei nicht veraendert.
 */
function mergeSnapshot(sn, previous, msg, now = Date.now()) {
    const base = previous ?? emptySnapshot(sn);
    const s = {
        ...base,
        sn,
        updatedAt: now,
        phases: { ...base.phases },
        pvStrings: new Map(base.pvStrings),
        batteryPacks: new Map(base.batteryPacks),
    };
    /*
     * Sobald das Geraet die Hauslast einmal selbst gemeldet hat, wird sie nie
     * wieder gerechnet. Sonst wuerde jede Nachricht ohne dieses Feld den guten
     * Wert durch den zu niedrigen ersetzen, und die Anzeige springt im
     * Sekundentakt hin und her.
     */
    let hauslastGemessen = base.housePowerMeasured;
    // ── Aeltere Generation (cmdFunc 96) ────────────────────────────────────────
    if (msg.energyStream) {
        const es = msg.energyStream;
        s.batterySoc = es.bpSoc;
        s.batteryPowerW = es.bpPwr;
        s.pvPowerW = es.mpptPwr;
        s.gridPowerW = es.sysGridPwr;
        s.housePowerW = es.sysLoadPwr; // hier echter Messwert
        hauslastGemessen = true;
    }
    if (msg.emsHeartbeat) {
        const hb = msg.emsHeartbeat;
        s.phases = {
            a: fullPhase(hb.pcsAPhase),
            b: fullPhase(hb.pcsBPhase),
            c: fullPhase(hb.pcsCPhase),
        };
        hb.pvStrings.forEach((pv, i) => s.pvStrings.set(i + 1, pv.pwr));
        if (s.batteryPowerW === null && hb.emsBpPower !== 0) {
            s.batteryPowerW = hb.emsBpPower;
        }
        if (hb.bpRemainWh > 0) {
            s.batteryRemainingWh = hb.bpRemainWh;
        }
    }
    for (const pack of msg.batteryPacks) {
        s.batteryPacks.set(pack.packIndex, {
            packIndex: pack.packIndex,
            sn: pack.sn,
            soc: pack.realSoc || pack.soc,
            temperature: pack.tempEnv,
            voltage: pack.vol,
            cellVoltage: null,
            remainingWh: pack.remainWh,
            powerW: pack.pwr,
            sohPercent: pack.soh,
            cycles: pack.cycles,
        });
    }
    // ── Neue Generation (cmdFunc 254) ──────────────────────────────────────────
    if (msg.po2Telemetry) {
        const t = msg.po2Telemetry;
        if (t.pvPowerW !== null) {
            s.pvPowerW = t.pvPowerW;
        }
        if (t.gridPowerW !== null) {
            s.gridPowerW = applyGridDeadband(t.gridPowerW);
        }
        if (t.batteryPowerW !== null) {
            s.batteryPowerW = t.batteryPowerW;
        }
        if (t.socPercent !== null && t.socPercent > 0) {
            s.batterySoc = t.socPercent;
        }
        if (t.remainingWh !== null && t.remainingWh > 0) {
            s.batteryRemainingWh = t.remainingWh;
        }
        if (t.pcsTotalW !== null) {
            s.inverterPowerW = t.pcsTotalW;
        }
        // Gemessen schlaegt gerechnet - siehe computeHouseLoad()
        if (t.housePowerW !== null) {
            s.housePowerW = Math.max(0, Math.round(t.housePowerW));
            hauslastGemessen = true;
        }
        // Phasen delta-kodiert: nur uebertragene Felder ueberschreiben
        const keys = [null, 'a', 'b', 'c'];
        for (const [index, partial] of t.phases) {
            const key = keys[index];
            if (!key) {
                continue;
            }
            s.phases[key] = mergePhase(s.phases[key], partial);
        }
        for (const [index, power] of t.pvStrings) {
            s.pvStrings.set(index, power);
        }
    }
    for (const pack of msg.po2BatteryPacks) {
        s.batteryPacks.set(pack.packIndex, {
            packIndex: pack.packIndex,
            sn: pack.sn,
            soc: pack.realSoc || pack.socPercent,
            temperature: pack.tempC,
            voltage: null,
            cellVoltage: pack.cellVoltageV,
            remainingWh: pack.remainingWh,
            powerW: pack.powerW,
            sohPercent: pack.sohPercent,
            cycles: pack.cycles,
        });
    }
    // Hauslast nur berechnen, wenn sie nicht schon gemessen vorliegt
    s.housePowerMeasured = hauslastGemessen;
    if (!hauslastGemessen) {
        s.housePowerW = computeHouseLoad(s);
    }
    return s;
}
const PHASE_KEYS = ['a', 'b', 'c'];
/**
 * Summe eines Phasenwerts ueber alle vorhandenen Phasen.
 *
 * Liefert bewusst `null`, sobald eine vorhandene Phase den Wert noch nicht
 * gemeldet hat - eine Teilsumme waere zu niedrig und damit irrefuehrend.
 * Phasen, die es am System gar nicht gibt (Objekt null), werden uebersprungen,
 * damit einphasige Anlagen trotzdem eine Summe bekommen.
 */
function sumPhases(s, key) {
    const present = PHASE_KEYS.map(k => s.phases[k]).filter((p) => p !== null);
    if (present.length === 0) {
        return null;
    }
    let sum = 0;
    for (const phase of present) {
        const value = phase[key];
        if (value === null) {
            return null; // unvollstaendig -> lieber nichts als eine zu kleine Summe
        }
        sum += value;
    }
    return sum;
}
/**
 * Mittelwert eines Phasenwerts (sinnvoll fuer die Spannung, wo Summieren unsinnig waere).
 */
function averagePhases(s, key) {
    const present = PHASE_KEYS.map(k => s.phases[k]).filter((p) => p !== null);
    const values = present.map(p => p[key]).filter((v) => v !== null);
    if (values.length === 0 || values.length !== present.length) {
        return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}
/**
 * True, wenn die Nachricht ueberhaupt verwertbare Daten enthielt.
 */
function hasPayload(msg) {
    return Boolean(msg.energyStream ||
        msg.emsHeartbeat ||
        msg.po2Telemetry ||
        msg.batteryPacks.length > 0 ||
        msg.po2BatteryPacks.length > 0);
}
//# sourceMappingURL=snapshot.js.map