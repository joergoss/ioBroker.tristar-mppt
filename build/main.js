"use strict";
/*
 * Created with @iobroker/create-adapter v2.0.1
 */
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
exports.TristarMppt = void 0;
const utils = __importStar(require("@iobroker/adapter-core"));
const config_1 = require("./config");
const tristarMpptTCPModbus_1 = require("./tristarMppt/tristarMpptTCPModbus");
const tristarMpptUtil_1 = require("./tristarMppt/tristarMpptUtil");
const STATIC_READ_INTERVAL_MS = 300000;
const COIL_READ_INTERVAL_MS = 5000;
class TristarMppt extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "tristar-mppt",
        });
        this.tristar = new tristarMpptTCPModbus_1.TristarMpptTCPModbus();
        this.mainLoopRunning = false;
        this.nextStaticRead = 0;
        this.nextCoilRead = 0;
        this.lastStateValues = new Map();
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
    async onReady() {
        await this.initObjects();
        await this.setConnectionState(false);
        try {
            (0, config_1.validateConfig)(this.config);
        }
        catch (error) {
            this.log.error(`Invalid configuration: ${this.errorText(error)}`);
            return;
        }
        if (this.config.enableControlWrites) {
            this.subscribeStates("control.*");
        }
        if (this.config.enableEepromWrites) {
            this.subscribeStates("eeprom.charge.*");
        }
        this.mainLoopRunning = true;
        void this.mainLoop();
    }
    async initObjects() {
        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                name: "Connected to the TriStar MPPT",
                type: "boolean",
                role: "indicator.connected",
                read: true,
                write: false,
            },
            native: {},
        });
        const channels = new Set();
        for (const [key, entry] of Object.entries(this.tristar.tristarData)) {
            const parts = key.split(".");
            for (let index = 1; index < parts.length; index++) {
                channels.add(parts.slice(0, index).join("."));
            }
            await this.createOrUpdateState(key, entry);
        }
        for (const channel of channels) {
            await this.setObjectNotExistsAsync(channel, {
                type: "channel",
                common: { name: channel },
                native: {},
            });
        }
        // Remove objects created by the original template and the incorrect
        // pre-0.0.3 daily-current mapping.
        await this.delObjectAsync("testVariable");
        await this.delObjectAsync("today.batt.Imax");
    }
    async createOrUpdateState(key, entry) {
        const writeAllowed = entry.source === "eeprom"
            ? this.config.enableEepromWrites === true
            : this.config.enableControlWrites === true;
        const writable = Boolean(entry.writeRegister || entry.writeCoil) && writeAllowed;
        const common = {
            name: entry.descr,
            type: entry.type,
            role: entry.role,
            read: !entry.writeCoil,
            write: writable,
            unit: entry.unit,
        };
        await this.setObjectNotExistsAsync(key, {
            type: "state",
            common,
            native: {},
        });
        await this.extendObjectAsync(key, { common });
    }
    updateStates() {
        const update = this.performUpdateStates();
        this.activeUpdate = update;
        const clear = () => {
            if (this.activeUpdate === update) {
                this.activeUpdate = undefined;
            }
        };
        void update.then(clear, clear);
        return update;
    }
    async performUpdateStates() {
        try {
            await this.tristar.readHoldingRegister(this.config);
        }
        catch (error) {
            if (this.mainLoopRunning) {
                await this.safeSetConnectionState(false);
                this.log.error(`Could not read TriStar data: ${this.errorText(error)}`);
            }
            return;
        }
        if (!this.mainLoopRunning) {
            return;
        }
        this.log.debug(`Raw holding registers: ${JSON.stringify(this.tristar.lastHoldingRegisters)}`);
        await this.safeSetConnectionState(true);
        if (Date.now() >= this.nextStaticRead) {
            try {
                await this.tristar.readStaticRegisters(this.config);
                this.nextStaticRead = Date.now() + STATIC_READ_INTERVAL_MS;
            }
            catch (error) {
                this.nextStaticRead = Date.now() + 60000;
                this.log.error(`Could not read static TriStar registers: ${this.errorText(error)}`);
            }
            if (!this.mainLoopRunning) {
                return;
            }
        }
        if (Date.now() >= this.nextCoilRead) {
            try {
                await this.tristar.readCoilStates(this.config);
                this.nextCoilRead = Date.now() + COIL_READ_INTERVAL_MS;
            }
            catch (error) {
                this.nextCoilRead = Date.now() + 60000;
                this.log.error(`Could not read TriStar coil states: ${this.errorText(error)}`);
            }
            if (!this.mainLoopRunning) {
                return;
            }
        }
        for (const [key, entry] of Object.entries(this.tristar.tristarData)) {
            if (!this.mainLoopRunning) {
                return;
            }
            if ((!entry.readRegister && !entry.readCoil) || entry.initialized === false) {
                continue;
            }
            if (!this.lastStateValues.has(key) || this.lastStateValues.get(key) !== entry.value) {
                try {
                    this.log.debug(`${key}: ${JSON.stringify(entry.value)}`);
                    await this.setStateAsync(key, { val: entry.value, ack: true });
                    this.lastStateValues.set(key, entry.value);
                }
                catch (error) {
                    this.log.error(`Could not publish ${key}: ${this.errorText(error)}`);
                }
            }
        }
    }
    async setConnectionState(connected) {
        if (this.connectionState !== connected) {
            await this.setStateAsync("info.connection", { val: connected, ack: true });
            this.connectionState = connected;
        }
    }
    async safeSetConnectionState(connected) {
        try {
            await this.setConnectionState(connected);
        }
        catch (error) {
            this.log.error(`Could not update info.connection: ${this.errorText(error)}`);
        }
    }
    onUnload(callback) {
        this.mainLoopRunning = false;
        if (this.timeoutRef) {
            clearTimeout(this.timeoutRef);
            this.timeoutRef = undefined;
        }
        const wakeUp = this.wakeUp;
        this.wakeUp = undefined;
        wakeUp === null || wakeUp === void 0 ? void 0 : wakeUp();
        this.tristar.close();
        let completed = false;
        let unloadTimeout;
        const done = () => {
            if (completed) {
                return;
            }
            completed = true;
            if (unloadTimeout) {
                clearTimeout(unloadTimeout);
            }
            callback();
        };
        if (this.activeUpdate) {
            unloadTimeout = setTimeout(done, 500);
            void this.activeUpdate.then(done, done);
        }
        else {
            done();
        }
    }
    async mainLoop() {
        while (this.mainLoopRunning) {
            await this.updateStates();
            if (this.mainLoopRunning) {
                await this.sleep(this.config.interval * 1000);
            }
        }
    }
    async sleep(ms) {
        return new Promise(resolve => {
            this.wakeUp = resolve;
            this.timeoutRef = setTimeout(() => {
                this.timeoutRef = undefined;
                this.wakeUp = undefined;
                resolve();
            }, ms);
        });
    }
    async onStateChange(id, state) {
        if (!state || state.ack || !this.mainLoopRunning) {
            return;
        }
        const key = (0, tristarMpptUtil_1.splitIdFromAdapter)(id);
        const entry = this.tristar.tristarData[key];
        if (!entry) {
            this.log.warn(`Ignoring command for unknown state ${id}`);
            return;
        }
        if (key.startsWith("control.") && this.config.enableControlWrites !== true) {
            this.log.error(`Ignoring ${key}: control writes are disabled in the adapter settings`);
            return;
        }
        try {
            if (entry.writeRegister) {
                if (typeof state.val !== "number" || !Number.isFinite(state.val)) {
                    throw new Error("Control value must be a finite number");
                }
                if (!this.tristar.tristarScale) {
                    throw new Error("Scaling values are not available yet; wait for a successful poll");
                }
                const writeData = { value: state.val, scale: this.tristar.tristarScale };
                const command = entry.writeRegister(writeData);
                if (entry.source === "eeprom") {
                    if (this.config.enableEepromWrites !== true) {
                        throw new Error("EEPROM writes are disabled; enable them explicitly in the adapter settings");
                    }
                    if (entry.initialized !== true || entry.rawValue === undefined) {
                        throw new Error("EEPROM value has not been read yet; wait for the static register refresh");
                    }
                    const previousRaw = entry.rawValue;
                    await this.tristar.writeEepromRegister(this.config, command, previousRaw);
                    await this.setStateAsync(key, { val: entry.value, ack: true });
                    this.lastStateValues.set(key, entry.value);
                    this.log.info(`EEPROM ${key}: raw ${previousRaw} -> ${command.value}, readback verified; controller reset is required to clear the EEPROM-changed fault`);
                }
                else {
                    await this.tristar.writeHoldingRegister(this.config, command);
                    await this.setStateAsync(key, { val: state.val, ack: true });
                }
                return;
            }
            if (entry.writeCoil) {
                if (typeof state.val !== "boolean") {
                    throw new Error("Coil command must be boolean");
                }
                if (!state.val) {
                    await this.setStateAsync(key, { val: false, ack: true });
                    return;
                }
                const command = entry.writeCoil({ value: true, scale: this.tristar.tristarScale });
                await this.tristar.writeCoil(this.config, command);
                await this.setStateAsync(key, { val: false, ack: true });
                return;
            }
            this.log.warn(`Ignoring write to read-only state ${key}`);
        }
        catch (error) {
            this.log.error(`Could not write ${key}: ${this.errorText(error)}`);
        }
    }
    errorText(error) {
        if (error instanceof Error) {
            return error.stack || error.message;
        }
        return String(error);
    }
}
exports.TristarMppt = TristarMppt;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new TristarMppt(options);
    module.exports.TristarMppt = TristarMppt;
}
else {
    // otherwise start the instance directly
    (() => new TristarMppt())();
}
//# sourceMappingURL=main.js.map