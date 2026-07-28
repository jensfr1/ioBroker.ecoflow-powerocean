/**
 * Definition des Objektbaums. Getrennt von main.ts, damit die Struktur an einer
 * Stelle nachvollziehbar ist und in Tests geprueft werden kann.
 *
 * Vorzeichen-Konventionen (auch in common.desc dokumentiert):
 *   battery.power  positiv = laden,  negativ = entladen
 *   grid.power     positiv = Bezug,  negativ = Einspeisung
 */

export interface StateDef {
    id: string;
    name: {
        en: string;
        de: string;
    };
    desc?: {
        en: string;
        de: string;
    };
    type: 'number' | 'string' | 'boolean';
    role: string;
    unit?: string;
    min?: number;
    max?: number;
}

export interface ChannelDef {
    id: string;
    name: {
        en: string;
        de: string;
    };
}

export const CHANNELS: ChannelDef[] = [
    { id: 'device', name: { en: 'Device', de: 'Gerät' } },
    { id: 'pv', name: { en: 'Photovoltaics', de: 'Photovoltaik' } },
    { id: 'pv.strings', name: { en: 'PV strings', de: 'PV-Strings' } },
    { id: 'battery', name: { en: 'Battery', de: 'Batterie' } },
    { id: 'battery.packs', name: { en: 'Battery modules', de: 'Batterie-Module' } },
    { id: 'grid', name: { en: 'Grid', de: 'Netz' } },
    { id: 'house', name: { en: 'House', de: 'Haus' } },
    { id: 'inverter', name: { en: 'Inverter', de: 'Wechselrichter' } },
    { id: 'energy', name: { en: 'Energy counters', de: 'Energiezähler' } },
    { id: 'phases', name: { en: 'Phases', de: 'Phasen' } },
];

export const STATES: StateDef[] = [
    {
        id: 'info.lastUpdate',
        name: { en: 'Last update', de: 'Letzte Aktualisierung' },
        type: 'number',
        role: 'value.time',
    },
    {
        id: 'device.sn',
        name: { en: 'Serial number', de: 'Seriennummer' },
        type: 'string',
        role: 'info.serial',
    },
    {
        id: 'pv.power',
        name: { en: 'PV power', de: 'PV-Leistung' },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        id: 'battery.soc',
        name: { en: 'State of charge', de: 'Ladestand' },
        type: 'number',
        role: 'value.battery',
        unit: '%',
        min: 0,
        max: 100,
    },
    {
        id: 'battery.power',
        name: { en: 'Battery power', de: 'Batterieleistung' },
        desc: {
            en: 'Positive = charging, negative = discharging',
            de: 'Positiv = laden, negativ = entladen',
        },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        id: 'battery.charging',
        name: { en: 'Battery is charging', de: 'Batterie lädt' },
        type: 'boolean',
        role: 'indicator',
    },
    {
        id: 'battery.remainingEnergy',
        name: { en: 'Remaining energy', de: 'Verbleibende Energie' },
        type: 'number',
        role: 'value.energy',
        unit: 'Wh',
    },
    {
        id: 'grid.power',
        name: { en: 'Grid power', de: 'Netzleistung' },
        desc: {
            en: 'Positive = import from grid, negative = export to grid',
            de: 'Positiv = Netzbezug, negativ = Einspeisung',
        },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        id: 'house.power',
        name: { en: 'House load (calculated)', de: 'Hauslast (berechnet)' },
        desc: {
            en: 'Not measured by the device. Calculated as PV - battery + grid.',
            de: 'Wird vom Gerät nicht gemessen. Berechnet als PV - Batterie + Netz.',
        },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        id: 'inverter.power',
        name: { en: 'Inverter output power', de: 'Wechselrichter-Ausgangsleistung' },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
];

/** Datenpunkte je Phase (a/b/c). */
export const PHASE_STATES: Array<Omit<StateDef, 'id'> & { key: string }> = [
    {
        key: 'voltage',
        name: { en: 'Voltage', de: 'Spannung' },
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
    },
    {
        key: 'current',
        name: { en: 'Current', de: 'Strom' },
        type: 'number',
        role: 'value.current',
        unit: 'A',
    },
    {
        key: 'activePower',
        name: { en: 'Active power', de: 'Wirkleistung' },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        key: 'reactivePower',
        name: { en: 'Reactive power', de: 'Blindleistung' },
        type: 'number',
        role: 'value.power',
        unit: 'var',
    },
    {
        key: 'apparentPower',
        name: { en: 'Apparent power', de: 'Scheinleistung' },
        type: 'number',
        role: 'value.power',
        unit: 'VA',
    },
];

/** Datenpunkte je Batterie-Modul. */
export const PACK_STATES: Array<Omit<StateDef, 'id'> & { key: string }> = [
    {
        key: 'soc',
        name: { en: 'State of charge', de: 'Ladestand' },
        type: 'number',
        role: 'value.battery',
        unit: '%',
        min: 0,
        max: 100,
    },
    {
        key: 'temperature',
        name: { en: 'Temperature', de: 'Temperatur' },
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    },
    {
        key: 'voltage',
        name: { en: 'Voltage', de: 'Spannung' },
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
    },
    {
        key: 'capacityWh',
        name: { en: 'Remaining energy', de: 'Verbleibende Energie' },
        type: 'number',
        role: 'value.energy',
        unit: 'Wh',
    },
    {
        key: 'power',
        name: { en: 'Power', de: 'Leistung' },
        desc: {
            en: 'Positive = charging, negative = discharging',
            de: 'Positiv = laden, negativ = entladen',
        },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        key: 'soh',
        name: { en: 'State of health', de: 'Alterungszustand' },
        type: 'number',
        role: 'value.battery',
        unit: '%',
        min: 0,
        max: 100,
    },
    {
        key: 'cycles',
        name: { en: 'Charge cycles', de: 'Ladezyklen' },
        type: 'number',
        role: 'value',
    },
    {
        key: 'sn',
        name: { en: 'Serial number', de: 'Seriennummer' },
        type: 'string',
        role: 'info.serial',
    },
];

/**
 * Energiezaehler in Wh.
 *
 * Das Geraet liefert nur Momentanleistung; diese Staende entstehen durch
 * Integration ueber die Zeit (siehe energy.ts). Sie laufen monoton nach oben
 * und werden ueber einen Adapterneustart hinweg fortgesetzt - Rolle und
 * Einheit sind so gewaehlt, dass History-Adapter und Auswertungen sie als
 * Zaehler erkennen.
 */
export const ENERGY_STATES: StateDef[] = [
    {
        id: 'energy.gridImported',
        name: { en: 'Grid consumption', de: 'Netzbezug' },
        type: 'number',
        role: 'value.energy.consumed',
        unit: 'Wh',
    },
    {
        id: 'energy.gridExported',
        name: { en: 'Grid return', de: 'Netzeinspeisung' },
        type: 'number',
        role: 'value.energy.produced',
        unit: 'Wh',
    },
    {
        id: 'energy.pvProduced',
        name: { en: 'Solar production', de: 'Solarerzeugung' },
        type: 'number',
        role: 'value.energy.produced',
        unit: 'Wh',
    },
    {
        id: 'energy.batteryCharged',
        name: { en: 'Battery charged', de: 'Batterie geladen' },
        type: 'number',
        role: 'value.energy.consumed',
        unit: 'Wh',
    },
    {
        id: 'energy.batteryDischarged',
        name: { en: 'Battery discharged', de: 'Batterie entladen' },
        type: 'number',
        role: 'value.energy.produced',
        unit: 'Wh',
    },
    {
        id: 'energy.houseConsumed',
        name: { en: 'House consumption', de: 'Hausverbrauch' },
        type: 'number',
        role: 'value.energy.consumed',
        unit: 'Wh',
    },
];

export const PHASE_KEYS = ['a', 'b', 'c'] as const;

/**
 * Summen-Datenpunkte ueber alle Phasen (Channel `phases.total`).
 * Leistungen und Strom werden addiert, die Spannung gemittelt.
 */
export const PHASE_TOTAL_STATES: StateDef[] = [
    {
        id: 'phases.total.activePower',
        name: { en: 'Active power (sum L1+L2+L3)', de: 'Wirkleistung (Summe L1+L2+L3)' },
        type: 'number',
        role: 'value.power',
        unit: 'W',
    },
    {
        id: 'phases.total.reactivePower',
        name: { en: 'Reactive power (sum)', de: 'Blindleistung (Summe)' },
        type: 'number',
        role: 'value.power',
        unit: 'var',
    },
    {
        id: 'phases.total.apparentPower',
        name: { en: 'Apparent power (sum)', de: 'Scheinleistung (Summe)' },
        type: 'number',
        role: 'value.power',
        unit: 'VA',
    },
    {
        id: 'phases.total.current',
        name: { en: 'Current (sum)', de: 'Strom (Summe)' },
        type: 'number',
        role: 'value.current',
        unit: 'A',
    },
    {
        id: 'phases.total.voltageAvg',
        name: { en: 'Voltage (average)', de: 'Spannung (Mittelwert)' },
        desc: {
            en: 'Average across all phases - summing voltages would be meaningless',
            de: 'Mittelwert über alle Phasen - eine Summe der Spannungen wäre unsinnig',
        },
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
    },
];
