"use strict";
/**
 * Definition des Objektbaums. Getrennt von main.ts, damit die Struktur an einer
 * Stelle nachvollziehbar ist und in Tests geprueft werden kann.
 *
 * Vorzeichen-Konventionen (auch in common.desc dokumentiert):
 *   battery.power  positiv = laden,  negativ = entladen
 *   grid.power     positiv = Bezug,  negativ = Einspeisung
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_TOTAL_STATES = exports.PHASE_KEYS = exports.PACK_STATES = exports.PHASE_STATES = exports.STATES = exports.CHANNELS = void 0;
exports.CHANNELS = [
    { id: 'device', name: { en: 'Device', de: 'Gerät' } },
    { id: 'pv', name: { en: 'Photovoltaics', de: 'Photovoltaik' } },
    { id: 'pv.strings', name: { en: 'PV strings', de: 'PV-Strings' } },
    { id: 'battery', name: { en: 'Battery', de: 'Batterie' } },
    { id: 'battery.packs', name: { en: 'Battery modules', de: 'Batterie-Module' } },
    { id: 'grid', name: { en: 'Grid', de: 'Netz' } },
    { id: 'house', name: { en: 'House', de: 'Haus' } },
    { id: 'inverter', name: { en: 'Inverter', de: 'Wechselrichter' } },
    { id: 'phases', name: { en: 'Phases', de: 'Phasen' } },
];
exports.STATES = [
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
exports.PHASE_STATES = [
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
exports.PACK_STATES = [
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
        key: 'sn',
        name: { en: 'Serial number', de: 'Seriennummer' },
        type: 'string',
        role: 'info.serial',
    },
];
exports.PHASE_KEYS = ['a', 'b', 'c'];
/**
 * Summen-Datenpunkte ueber alle Phasen (Channel `phases.total`).
 * Leistungen und Strom werden addiert, die Spannung gemittelt.
 */
exports.PHASE_TOTAL_STATES = [
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
//# sourceMappingURL=objects.js.map