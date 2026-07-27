"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcoflowClient = void 0;
/**
 * Anbindung an das App-MQTT von EcoFlow.
 *
 * Warum nicht die offizielle Developer-API? Fuer PowerOcean liefert sie keine
 * Livedaten (Fehler 1006 "current device is not allowed to get device info"),
 * und das offizielle MQTT-Topic sendet nichts. Der einzige funktionierende Weg
 * ist der Broker, den auch die EcoFlow-App nutzt.
 *
 * Ablauf:
 *   1. POST /auth/login                       -> Token + userId
 *   2. GET  /iot-auth/app/certification       -> MQTT-Zugangsdaten
 *   3. Subscribe /app/device/property/{SN}    -> Protobuf-Telemetrie
 *   4. Publish  .../thing/property/get        -> "latestQuotas" als Weckruf
 *
 * Schritt 4 ist zwingend: Ohne diesen Trigger sendet das Geraet nichts,
 * solange keine EcoFlow-App geoeffnet ist.
 */
const mqtt_1 = __importDefault(require("mqtt"));
const node_crypto_1 = require("node:crypto");
const protobuf_1 = require("./protobuf");
const snapshot_1 = require("./snapshot");
const LOGIN_URL = 'https://api.ecoflow.com/auth/login';
const CERT_URL = 'https://api.ecoflow.com/iot-auth/app/certification';
/** Weckruf-Intervall; das Geraet verstummt sonst nach einiger Zeit. */
const QUOTA_TRIGGER_MS = 60_000;
/** Nach so vielen erfolglosen Reconnects wird komplett neu eingeloggt. */
const RECONNECTS_BEFORE_RELOGIN = 3;
class EcoflowClient {
    options;
    client = null;
    /** null = kein Timer aktiv (TimerHandle ist unknown, schliesst null ein). */
    triggerTimer = null;
    snapshot = null;
    session = null;
    reconnectCount = 0;
    stopped = false;
    constructor(options) {
        this.options = options;
    }
    /** Login, MQTT-Verbindung aufbauen und Telemetrie abonnieren. */
    async start() {
        this.stopped = false;
        await this.connect();
    }
    /**
     * Alles sauber abbauen. Muss in onUnload aufgerufen werden, sonst laeuft der
     * Trigger-Timer weiter und ioBroker meldet "Adapter did not stop".
     */
    async stop() {
        this.stopped = true;
        if (this.triggerTimer) {
            this.options.clearInterval(this.triggerTimer);
            this.triggerTimer = null;
        }
        const client = this.client;
        this.client = null;
        if (client) {
            await new Promise(resolve => client.end(true, {}, () => resolve()));
        }
        this.options.onConnectionChange(false);
    }
    // ── HTTP-Teil ──────────────────────────────────────────────────────────────
    async login() {
        const response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', lang: 'en_US' },
            body: JSON.stringify({
                email: this.options.email,
                password: Buffer.from(this.options.password).toString('base64'),
                scene: 'IOT_APP',
                userType: 'ECOFLOW',
            }),
        });
        const json = (await response.json());
        if (json.code !== '0' || !json.data) {
            throw new Error(`Login failed: ${json.message} (code ${json.code})`);
        }
        return { token: json.data.token, userId: json.data.user.userId };
    }
    async fetchMqttCredentials(session) {
        const response = await fetch(`${CERT_URL}?userId=${encodeURIComponent(session.userId)}`, {
            headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        });
        const json = (await response.json());
        if (json.code !== '0' || !json.data) {
            throw new Error(`MQTT certification failed: ${json.message} (code ${json.code})`);
        }
        return json.data;
    }
    // ── MQTT-Teil ──────────────────────────────────────────────────────────────
    async connect() {
        const session = await this.login();
        this.session = session;
        const cert = await this.fetchMqttCredentials(session);
        this.options.log.info(`Connecting to ${cert.url}:${cert.port}`);
        // Der ANDROID_-Praefix ist noetig, sonst weist der Broker die Verbindung ab.
        const clientId = `ANDROID_${(0, node_crypto_1.randomUUID)().replace(/-/g, '').toUpperCase()}_${session.userId}`;
        const client = mqtt_1.default.connect(`${cert.protocol}://${cert.url}:${cert.port}`, {
            username: cert.certificateAccount,
            password: cert.certificatePassword,
            clientId,
            reconnectPeriod: 10_000,
            clean: true,
        });
        this.client = client;
        const propertyTopic = `/app/device/property/${this.options.deviceSn}`;
        const getTopic = `/app/${session.userId}/${this.options.deviceSn}/thing/property/get`;
        client.on('connect', () => {
            this.reconnectCount = 0;
            this.options.log.info('MQTT connected');
            this.options.onConnectionChange(true);
            client.subscribe(propertyTopic, err => {
                if (err) {
                    this.options.log.error(`Subscribe failed: ${err.message}`);
                    return;
                }
                this.options.log.debug(`Subscribed to ${propertyTopic}`);
                this.requestLatestQuotas(getTopic);
            });
        });
        client.on('message', (_topic, payload) => this.handleMessage(payload));
        client.on('error', err => {
            this.options.log.error(`MQTT error: ${err.message}`);
        });
        client.on('close', () => {
            this.options.onConnectionChange(false);
        });
        // Nach mehreren erfolglosen Versuchen sind die Credentials vermutlich
        // abgelaufen - dann komplett neu einloggen statt endlos zu reconnecten.
        client.on('reconnect', () => {
            this.reconnectCount++;
            this.options.log.debug(`MQTT reconnect attempt ${this.reconnectCount}`);
            if (this.reconnectCount >= RECONNECTS_BEFORE_RELOGIN && !this.stopped) {
                this.options.log.warn('Repeated reconnects - refreshing credentials');
                void this.restart();
            }
        });
        if (this.triggerTimer) {
            this.options.clearInterval(this.triggerTimer);
        }
        this.triggerTimer = this.options.setInterval(() => this.requestLatestQuotas(getTopic), QUOTA_TRIGGER_MS);
    }
    /** Verbindung verwerfen und mit frischen Zugangsdaten neu aufbauen. */
    async restart() {
        const client = this.client;
        this.client = null;
        this.reconnectCount = 0;
        if (client) {
            client.end(true);
        }
        if (this.stopped) {
            return;
        }
        try {
            await this.connect();
        }
        catch (error) {
            this.options.log.error(`Reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Weckruf: ohne diese Anfrage sendet das Geraet keine Telemetrie.
     */
    requestLatestQuotas(topic) {
        if (!this.client?.connected) {
            return;
        }
        this.client.publish(topic, JSON.stringify({
            from: 'Android',
            id: String(Math.floor(Math.random() * 1e9)),
            moduleType: 0,
            operateType: 'latestQuotas',
            params: {},
            version: '1.0',
        }));
    }
    handleMessage(payload) {
        try {
            const decoded = (0, protobuf_1.decodeMqttPayload)(payload);
            if (!(0, snapshot_1.hasPayload)(decoded)) {
                return;
            }
            this.snapshot = (0, snapshot_1.mergeSnapshot)(this.options.deviceSn, this.snapshot, decoded);
            this.options.onSnapshot(this.snapshot);
        }
        catch (error) {
            this.options.log.debug(`Decode error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
exports.EcoflowClient = EcoflowClient;
//# sourceMappingURL=ecoflow-client.js.map