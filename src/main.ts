/**
 * ioBroker-Adapter fuer EcoFlow PowerOcean.
 *
 * Liest Livedaten ueber das App-MQTT von EcoFlow (die offizielle Developer-API
 * liefert fuer PowerOcean keine Livedaten) und schreibt sie in den Objektbaum.
 */
import * as utils from '@iobroker/adapter-core';
import { EcoflowClient } from './lib/ecoflow-client';
import { sumPhases, averagePhases, type Snapshot } from './lib/snapshot';
import {
    CHANNELS,
    STATES,
    PHASE_STATES,
    PHASE_TOTAL_STATES,
    PACK_STATES,
    PHASE_KEYS,
    type StateDef,
} from './lib/objects';

class EcoflowPowerOceanAdapter extends utils.Adapter {
    private client: EcoflowClient | null = null;
    private lastWrite = 0;
    /** Bereits angelegte dynamische Objekte (PV-Strings, Batterie-Module). */
    private readonly createdObjects = new Set<string>();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'ecoflow-powerocean' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const { email, password, deviceSn } = this.config;

        if (!email || !password || !deviceSn) {
            this.log.error('E-mail, password and serial number must be configured');
            return;
        }

        await this.setStateAsync('info.connection', { val: false, ack: true });
        await this.createStaticObjects();
        await this.setStateAsync('device.sn', { val: deviceSn, ack: true });

        this.client = new EcoflowClient({
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
            clearInterval: timer => this.clearInterval(timer as ioBroker.Interval),
        });

        try {
            await this.client.start();
        } catch (error) {
            this.log.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async onUnload(callback: () => void): Promise<void> {
        try {
            await this.client?.stop();
            this.client = null;
            await this.setStateAsync('info.connection', { val: false, ack: true });
        } catch {
            // beim Herunterfahren nicht weiter stoeren
        } finally {
            callback();
        }
    }

    // ── Objektbaum ─────────────────────────────────────────────────────────────

    private async createStaticObjects(): Promise<void> {
        for (const channel of CHANNELS) {
            await this.setObjectNotExistsAsync(channel.id, {
                type: 'channel',
                common: { name: channel.name },
                native: {},
            });
        }
        for (const state of STATES) {
            await this.defineState(state);
        }
        for (const phase of PHASE_KEYS) {
            await this.setObjectNotExistsAsync(`phases.${phase}`, {
                type: 'channel',
                common: {
                    name: { en: `Phase ${phase.toUpperCase()}`, de: `Phase ${phase.toUpperCase()}` },
                },
                native: {},
            });
            for (const def of PHASE_STATES) {
                await this.defineState({ ...def, id: `phases.${phase}.${def.key}` });
            }
        }
        await this.setObjectNotExistsAsync('phases.total', {
            type: 'channel',
            common: { name: { en: 'All phases', de: 'Alle Phasen' } },
            native: {},
        });
        for (const def of PHASE_TOTAL_STATES) {
            await this.defineState(def);
        }
    }

    /**
     * Legt einen State an (Name bewusst nicht "createState" - kollidiert mit der Basisklasse).
     */
    private async defineState(def: StateDef): Promise<void> {
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
    private async ensureDynamicChannel(
        channelId: string,
        channelName: { en: string; de: string },
        defs: Array<Omit<StateDef, 'id'> & { key: string }>,
    ): Promise<void> {
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

    // ── Datenuebernahme ────────────────────────────────────────────────────────

    private async onSnapshot(snapshot: Snapshot): Promise<void> {
        // Das Geraet sendet ca. alle 2 s - so oft muessen die States nicht schreiben.
        const throttleMs = Math.max(1, Number(this.config.throttleSeconds) || 10) * 1000;
        const now = Date.now();
        if (now - this.lastWrite < throttleMs) {
            return;
        }
        this.lastWrite = now;

        try {
            await this.writeSnapshot(snapshot);
        } catch (error) {
            this.log.warn(`Could not write states: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async writeSnapshot(s: Snapshot): Promise<void> {
        const set = async (id: string, value: number | string | boolean | null): Promise<void> => {
            if (value === null || value === undefined) {
                return;
            }
            await this.setStateAsync(id, { val: value, ack: true });
        };

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

        for (const key of PHASE_KEYS) {
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

        await set('phases.total.activePower', round(sumPhases(s, 'activePower')));
        await set('phases.total.reactivePower', round(sumPhases(s, 'reactivePower')));
        await set('phases.total.apparentPower', round(sumPhases(s, 'apparentPower')));
        await set('phases.total.current', round(sumPhases(s, 'current'), 2));
        await set('phases.total.voltageAvg', round(averagePhases(s, 'voltage'), 1));

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
            await this.ensureDynamicChannel(channelId, { en: `Module ${index}`, de: `Modul ${index}` }, PACK_STATES);
            await set(`${channelId}.soc`, round(pack.soc, 1));
            await set(`${channelId}.temperature`, round(pack.temperature, 1));
            await set(`${channelId}.voltage`, round(pack.voltage, 1));
            await set(`${channelId}.capacityWh`, round(pack.capacityWh));
            await set(`${channelId}.power`, round(pack.powerW));
            await set(`${channelId}.soh`, round(pack.sohPercent, 1));
            await set(`${channelId}.cycles`, round(pack.cycles));
            await set(`${channelId}.sn`, pack.sn);
        }
    }
}

function round(value: number | null, digits = 0): number | null {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new EcoflowPowerOceanAdapter(options);
} else {
    (() => new EcoflowPowerOceanAdapter())();
}
