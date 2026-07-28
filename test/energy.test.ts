import { describe, expect, it } from 'vitest';
import { EnergyIntegrator, MAX_GAP_MS, positivePart, negativePart } from '../src/lib/energy';

const MINUTE = 60_000;

describe('EnergyIntegrator', () => {
    it('rechnet konstante Leistung korrekt hoch', () => {
        const e = new EnergyIntegrator();
        // 1000 W ueber eine Stunde in Schritten von einer Minute = 1000 Wh
        let t = 0;
        e.add(1000, t);
        for (let i = 0; i < 60; i++) {
            t += MINUTE;
            e.add(1000, t);
        }
        expect(e.total).toBeCloseTo(1000, 6);
    });

    it('mittelt bei wechselnder Leistung (Trapezregel)', () => {
        const e = new EnergyIntegrator();
        // Anstieg von 0 auf 2000 W ueber eine Minute: Mittelwert 1000 W,
        // also 1000 Wh / 60 = 16,67 Wh. Bewusst innerhalb der Lueckengrenze -
        // ein Intervall von einer Stunde wuerde (korrekt) verworfen.
        e.add(0, 0);
        e.add(2000, MINUTE);
        expect(e.total).toBeCloseTo(1000 / 60, 6);
    });

    it('rechnet die erste Messung noch nicht an', () => {
        const e = new EnergyIntegrator();
        expect(e.add(5000, 0)).toBe(0);
    });

    it('ueberspringt zu grosse Luecken statt sie hochzurechnen', () => {
        const e = new EnergyIntegrator();
        e.add(3000, 0);
        e.add(3000, MAX_GAP_MS + 1);
        // Eine Stunde Ausfall darf keine erfundenen kWh erzeugen
        expect(e.total).toBe(0);
    });

    it('ignoriert Rueckspruenge der Uhr', () => {
        const e = new EnergyIntegrator();
        e.add(1000, 10 * MINUTE);
        e.add(1000, 5 * MINUTE);
        expect(e.total).toBe(0);
    });

    it('ignoriert fehlende Messwerte', () => {
        const e = new EnergyIntegrator();
        e.add(1000, 0);
        e.add(null, MINUTE);
        e.add(1000, 2 * MINUTE);
        // Der null-Wert unterbricht nicht, aber zaehlt auch nicht doppelt
        expect(e.total).toBeCloseTo((1000 * 2) / 60, 6);
    });

    it('setzt nach dem Wiederherstellen fort, ohne die Luecke zu fuellen', () => {
        const e = new EnergyIntegrator();
        e.restore(4200);
        expect(e.total).toBe(4200);
        // Erster Wert nach dem Neustart darf nichts anrechnen
        e.add(9000, 0);
        expect(e.total).toBe(4200);
        e.add(9000, MINUTE);
        expect(e.total).toBeCloseTo(4200 + 150, 6);
    });

    it('verwirft unbrauchbare Staende beim Wiederherstellen', () => {
        const e = new EnergyIntegrator();
        e.restore(Number.NaN);
        expect(e.total).toBe(0);
        e.restore(-5);
        expect(e.total).toBe(0);
    });
});

describe('positivePart / negativePart', () => {
    it('trennt Bezug und Einspeisung', () => {
        expect(positivePart(1700)).toBe(1700);
        expect(negativePart(1700)).toBe(0);
        expect(positivePart(-800)).toBe(0);
        expect(negativePart(-800)).toBe(800);
    });

    it('reicht null durch', () => {
        expect(positivePart(null)).toBeNull();
        expect(negativePart(null)).toBeNull();
    });
});
