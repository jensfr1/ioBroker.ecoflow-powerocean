"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ioBroker-Adapter fuer EcoFlow PowerOcean.
 *
 * Liest Livedaten ueber das App-MQTT von EcoFlow (die offizielle Developer-API
 * liefert fuer PowerOcean keine Livedaten) und schreibt sie in den Objektbaum.
 */
const utils = __importStar(require("@iobroker/adapter-core"));
const ecoflow_client_1 = require("./lib/ecoflow-client");
const snapshot_1 = require("./lib/snapshot");
const energy_1 = require("./lib/energy");
const objects_1 = require("./lib/objects");
class EcoflowPowerOceanAdapter extends utils.Adapter {
    client = null;
    lastWrite = 0;
    /** Bereits angelegte dynamische Objekte (PV-Strings, Batterie-Module). */
    createdObjects = new Set();
    /**
     * Energiezaehler je State-ID. Das Geraet liefert nur Leistung; die kWh
     * entstehen durch Integration ueber die Zeit.
     */
    energy = new Map();
    constructor(options = {}) {
        super({ ...options, name: 'ecoflow-powerocean' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    async onReady() {
        const { email, password, deviceSn } = this.config;
        if (!email || !password || !deviceSn) {
            this.log.error('E-mail, password and serial number must be configured');
            return;
        }
        await this.setStateAsync('info.connection', { val: false, ack: true });
        await this.createStaticObjects();
        await this.setStateAsync('device.sn', { val: deviceSn, ack: true });
        await this.restoreEnergyCounters();
        this.client = new ecoflow_client_1.EcoflowClient({
            email,
            password,
            deviceSn,
            log: {
                debug: m => this.log.debug(m),
                info: m => this.log.info(m),
                warn: m => this.log.warn(m),
                error: m => this.log.error(m),
            },
            onSnapshot: snapshot => void this.onSnapshot(snapshot),
            onConnectionChange: connected => {
                void this.setStateAsync('info.connection', { val: connected, ack: true });
            },
            // Timer ueber den Adapter fuehren, damit der js-controller sie beim
            // Entladen mit abraeumt - sonst "Adapter did not stop".
            setInterval: (handler, ms) => this.setInterval(handler, ms),
            clearInterval: timer => this.clearInterval(timer),
        });
        try {
            await this.client.start();
        }
        catch (error) {
            this.log.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async onUnload(callback) {
        try {
            await this.client?.stop();
            this.client = null;
            await this.setStateAsync('info.connection', { val: false, ack: true });
        }
        catch {
            // beim Herunterfahren nicht weiter stoeren
        }
        finally {
            callback();
        }
    }
    // ── Objektbaum ─────────────────────────────────────────────────────────────
    async createStaticObjects() {
        for (const channel of objects_1.CHANNELS) {
            await this.setObjectNotExistsAsync(channel.id, {
                type: 'channel',
                common: { name: channel.name },
                native: {},
            });
        }
        for (const state of objects_1.STATES) {
            await this.defineState(state);
        }
        for (const state of objects_1.ENERGY_STATES) {
            await this.defineState(state);
        }
        for (const phase of objects_1.PHASE_KEYS) {
            await this.setObjectNotExistsAsync(`phases.${phase}`, {
                type: 'channel',
                common: {
                    name: { en: `Phase ${phase.toUpperCase()}`, de: `Phase ${phase.toUpperCase()}` },
                },
                native: {},
            });
            for (const def of objects_1.PHASE_STATES) {
                await this.defineState({ ...def, id: `phases.${phase}.${def.key}` });
            }
        }
        await this.setObjectNotExistsAsync('phases.total', {
            type: 'channel',
            common: { name: { en: 'All phases', de: 'Alle Phasen' } },
            native: {},
        });
        for (const def of objects_1.PHASE_TOTAL_STATES) {
            await this.defineState(def);
        }
    }
    /**
     * Legt einen State an (Name bewusst nicht "createState" - kollidiert mit der Basisklasse).
     */
    async defineState(def) {
        await this.setObjectNotExistsAsync(def.id, {
            type: 'state',
            common: {
                name: def.name,
                desc: def.desc,
                type: def.type,
                role: def.role,
                unit: def.unit,
                min: def.min,
                max: def.max,
                read: true,
                write: false,
            },
            native: {},
        });
    }
    /**
     * Legt PV-String- bzw. Batterie-Modul-Objekte beim ersten Auftreten an.
     */
    async ensureDynamicChannel(channelId, channelName, defs) {
        if (this.createdObjects.has(channelId)) {
            return;
        }
        this.createdObjects.add(channelId);
        await this.setObjectNotExistsAsync(channelId, {
            type: 'channel',
            common: { name: channelName },
            native: {},
        });
        for (const def of defs) {
            await this.defineState({ ...def, id: `${channelId}.${def.key}` });
        }
    }
    /**
     * Zaehlerstaende aus dem Objektbaum uebernehmen.
     *
     * Ohne diesen Schritt faengt jeder Adapterstart bei 0 an, und jede
     * History sieht einen Sprung nach unten. Der Zeitbezug wird bewusst NICHT
     * wiederhergestellt - die Zeit seit dem letzten Wert ist eine Luecke.
     */
    async restoreEnergyCounters() {
        for (const def of objects_1.ENERGY_STATES) {
            const integrator = new energy_1.EnergyIntegrator();
            const state = await this.getStateAsync(def.id);
            if (state && typeof state.val === 'number') {
                integrator.restore(state.val);
            }
            this.energy.set(def.id, integrator);
        }
    }
    /** Leistungswerte auf die Zaehler geben und die neuen Staende schreiben. */
    async updateEnergyCounters(s, now) {
        const werte = [
            ['energy.gridImported', (0, energy_1.positivePart)(s.gridPowerW)],
            ['energy.gridExported', (0, energy_1.negativePart)(s.gridPowerW)],
            ['energy.pvProduced', s.pvPowerW],
            ['energy.batteryCharged', (0, energy_1.positivePart)(s.batteryPowerW)],
            ['energy.batteryDischarged', (0, energy_1.negativePart)(s.batteryPowerW)],
            ['energy.houseConsumed', s.housePowerW],
        ];
        for (const [id, leistung] of werte) {
            const integrator = this.energy.get(id);
            if (!integrator) {
                continue;
            }
            const total = integrator.add(leistung, now);
            await this.setStateAsync(id, { val: Math.round(total * 1000) / 1000, ack: true });
        }
    }
    // ── Datenuebernahme ────────────────────────────────────────────────────────
    async onSnapshot(snapshot) {
        // Das Geraet sendet ca. alle 2 s - so oft muessen die States nicht schreiben.
        const throttleMs = Math.max(1, Number(this.config.throttleSeconds) || 10) * 1000;
        const now = Date.now();
        if (now - this.lastWrite < throttleMs) {
            return;
        }
        this.lastWrite = now;
        try {
            await this.writeSnapshot(snapshot);
        }
        catch (error) {
            this.log.warn(`Could not write states: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async writeSnapshot(s) {
        const set = async (id, value) => {
            if (value === null || value === undefined) {
                return;
            }
            await this.setStateAsync(id, { val: value, ack: true });
        };
        await this.updateEnergyCounters(s, s.updatedAt);
        await set('info.lastUpdate', s.updatedAt);
        await set('pv.power', round(s.pvPowerW));
        await set('battery.soc', round(s.batterySoc, 1));
        await set('battery.power', round(s.batteryPowerW));
        await set('battery.remainingEnergy', round(s.batteryRemainingWh));
        await set('grid.power', round(s.gridPowerW));
        await set('house.power', round(s.housePowerW));
        await set('inverter.power', round(s.inverterPowerW));
        if (s.batteryPowerW !== null) {
            await set('battery.charging', s.batteryPowerW > 0);
        }
        for (const key of objects_1.PHASE_KEYS) {
            const phase = s.phases[key];
            if (!phase) {
                continue;
            }
            await set(`phases.${key}.voltage`, round(phase.voltage, 1));
            await set(`phases.${key}.current`, round(phase.current, 2));
            await set(`phases.${key}.activePower`, round(phase.activePower));
            await set(`phases.${key}.reactivePower`, round(phase.reactivePower));
            await set(`phases.${key}.apparentPower`, round(phase.apparentPower));
        }
        await set('phases.total.activePower', round((0, snapshot_1.sumPhases)(s, 'activePower')));
        await set('phases.total.reactivePower', round((0, snapshot_1.sumPhases)(s, 'reactivePower')));
        await set('phases.total.apparentPower', round((0, snapshot_1.sumPhases)(s, 'apparentPower')));
        await set('phases.total.current', round((0, snapshot_1.sumPhases)(s, 'current'), 2));
        await set('phases.total.voltageAvg', round((0, snapshot_1.averagePhases)(s, 'voltage'), 1));
        for (const [index, power] of s.pvStrings) {
            const channelId = `pv.strings.${index}`;
            await this.ensureDynamicChannel(channelId, { en: `String ${index}`, de: `String ${index}` }, [
                {
                    key: 'power',
                    name: { en: 'Power', de: 'Leistung' },
                    type: 'number',
                    role: 'value.power',
                    unit: 'W',
                },
            ]);
            await set(`${channelId}.power`, round(power));
        }
        for (const [index, pack] of s.batteryPacks) {
            const channelId = `battery.packs.${index}`;
            await this.ensureDynamicChannel(channelId, { en: `Module ${index}`, de: `Modul ${index}` }, objects_1.PACK_STATES);
            await set(`${channelId}.soc`, round(pack.soc, 1));
            await set(`${channelId}.temperature`, round(pack.temperature, 1));
            await set(`${channelId}.cellVoltage`, round(pack.cellVoltage, 3));
            await set(`${channelId}.remainingWh`, round(pack.remainingWh));
            await set(`${channelId}.power`, round(pack.powerW));
            await set(`${channelId}.soh`, round(pack.sohPercent, 1));
            await set(`${channelId}.cycles`, round(pack.cycles));
            await set(`${channelId}.sn`, pack.sn);
        }
    }
}
function round(value, digits = 0) {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
if (require.main !== module) {
    module.exports = (options) => new EcoflowPowerOceanAdapter(options);
}
else {
    (() => new EcoflowPowerOceanAdapter())();
}
//# sourceMappingURL=main.js.map