"use strict";
/**
 * Energiezaehler aus Leistungswerten.
 *
 * Das Geraet meldet nur Momentanleistung. Fuers Energie-Dashboard - und fuer
 * jede Auswertung ueber Zeitraeume - braucht es kWh-Zaehler. Die entstehen
 * hier durch Integration ueber die Zeit (Trapezregel).
 *
 * Zwei Dinge sind dabei wichtig:
 *
 * - **Luecken nicht mitintegrieren.** War die Verbindung eine Stunde weg, darf
 *   die letzte bekannte Leistung nicht ueber diese Stunde hochgerechnet
 *   werden - das erfindet Energie, die vielleicht nie geflossen ist. Ab
 *   `MAX_GAP_MS` wird das Intervall verworfen.
 * - **Neustartfest.** Der Zaehlerstand wird aus dem Objektbaum wieder
 *   hergestellt, sonst faellt er nach jedem Adapterstart auf 0 zurueck und
 *   jede History sieht einen Sprung.
 *
 * Bewusst frei von ioBroker-Importen, damit die Logik isoliert testbar bleibt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnergyIntegrator = exports.MAX_GAP_MS = void 0;
exports.positivePart = positivePart;
exports.negativePart = negativePart;
/** Laengere Pausen werden nicht integriert (Verbindungsabbruch, Neustart). */
exports.MAX_GAP_MS = 300_000;
class EnergyIntegrator {
    totalWh = 0;
    lastTime = null;
    lastPower = null;
    /** Aktueller Zaehlerstand in Wh. */
    get total() {
        return this.totalWh;
    }
    /**
     * Setzt einen wiederhergestellten Zaehlerstand.
     *
     * Der Zeitbezug wird bewusst NICHT wiederhergestellt: Die Zeit seit dem
     * letzten Wert vor dem Neustart ist eine Luecke und wird nicht gefuellt.
     */
    restore(totalWh) {
        this.totalWh = Number.isFinite(totalWh) && totalWh > 0 ? totalWh : 0;
        this.lastTime = null;
        this.lastPower = null;
    }
    /** Verarbeitet einen Messwert und gibt den Zaehlerstand in Wh zurueck. */
    add(powerW, now) {
        if (powerW === null) {
            return this.totalWh;
        }
        const previousTime = this.lastTime;
        const previousPower = this.lastPower;
        this.lastTime = now;
        this.lastPower = powerW;
        if (previousTime === null || previousPower === null) {
            return this.totalWh;
        }
        const elapsed = now - previousTime;
        if (elapsed <= 0 || elapsed > exports.MAX_GAP_MS) {
            // Ruecksprung der Uhr oder zu grosse Luecke - nichts anrechnen
            return this.totalWh;
        }
        // Trapezregel: Mittelwert beider Leistungen ueber das Intervall
        this.totalWh += ((previousPower + powerW) / 2) * (elapsed / 3_600_000);
        return this.totalWh;
    }
}
exports.EnergyIntegrator = EnergyIntegrator;
/** Nur der positive Anteil, z.B. Netzbezug aus der signierten Netzleistung. */
function positivePart(value) {
    return value === null ? null : Math.max(0, value);
}
/** Nur der negative Anteil als positive Zahl, z.B. Einspeisung. */
function negativePart(value) {
    return value === null ? null : Math.max(0, -value);
}
//# sourceMappingURL=energy.js.map