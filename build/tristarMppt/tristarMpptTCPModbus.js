"use strict";
// Tristar MODBUS
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
exports.TristarMpptTCPModbus = void 0;
const modbus = __importStar(require("jsmodbus"));
const net = __importStar(require("net"));
const solarSnapshotFilter_1 = require("./solarSnapshotFilter");
const tristarMpptModel_1 = require("./tristarMpptModel");
const tristarMpptStaticModel_1 = require("./tristarMpptStaticModel");
const tristarMpptUtil_1 = require("./tristarMpptUtil");
const SOCKET_TIMEOUT_MS = 10000;
const STATIC_REGISTER_BLOCKS = [
    { start: 0x1000, count: 1 },
    { start: 0x100f, count: 10 },
    { start: 0x101d, count: 9 },
    { start: 0x1026, count: 11 },
    { start: 0x151b, count: 5 },
    { start: 0x1520, count: 2 },
    { start: 0xe000, count: 12 },
    { start: 0xe00d, count: 6 },
    { start: 0xe015, count: 6 },
    { start: 0xe01d, count: 1 },
    { start: 0xe020, count: 2 },
    { start: 0xe080, count: 13 },
    { start: 0xe0c0, count: 4 },
    { start: 0xe0cc, count: 2 },
];
class TristarMpptTCPModbus {
    constructor() {
        this.tristarData = { ...new tristarMpptModel_1.TristarModel(), ...new tristarMpptStaticModel_1.TristarStaticModel() };
        this.lastHoldingRegisters = [];
        this.lastStaticRegisters = new Map();
        this.staticDataLoaded = false;
        this.staticDataStale = true;
        this.eepromWriteVersion = 0;
        this.operation = Promise.resolve();
        this.solarFilter = new solarSnapshotFilter_1.SolarSnapshotFilter();
        this.stopping = false;
    }
    async updateTristarData(hr, config) {
        const scaleSignature = hr.slice(0, 4).join(",");
        if (this.scaleSignature !== undefined && this.scaleSignature !== scaleSignature) {
            this.invalidateStaticData();
        }
        this.scaleSignature = scaleSignature;
        const tmd = new tristarMpptModel_1.TristarModbusData(hr, config);
        this.tristarScale = tmd.scale;
        tmd.filteredSolar = this.solarFilter.add(hr.slice(0, 4).join(","), {
            current: (0, tristarMpptUtil_1.signedToInteger)(hr[29]) * tmd.scale.i,
            power: hr[59] * tmd.scale.p,
        });
        for (const value of Object.values(this.tristarData)) {
            const entry = value;
            if (!entry.source && typeof entry.readRegister === "function") {
                entry.valueOld = entry.value;
                entry.value = entry.readRegister(tmd);
                entry.initialized = true;
            }
        }
    }
    invalidateStaticData() {
        for (const entry of Object.values(this.tristarData)) {
            if (entry.source === "network" || entry.source === "eeprom") {
                entry.valueOld = entry.value;
                entry.value = null;
                entry.initialized = false;
                entry.rawValue = undefined;
            }
        }
        this.lastStaticRegisters = new Map();
        this.staticDataLoaded = false;
        this.staticDataStale = true;
    }
    async writeHoldingRegister(adapterConfig, command, expectedScaleSignature) {
        await this.enqueue(() => {
            this.assertScaleSignature(expectedScaleSignature);
            return this.connect(adapterConfig, async (client) => {
                await client.writeSingleRegister(command.register, command.value);
            });
        });
    }
    async readHoldingRegister(adapterConfig) {
        try {
            await this.enqueue(() => this.connect(adapterConfig, async (client) => {
                const response = await client.readHoldingRegisters(0, 92);
                const values = response.response.body.valuesAsArray;
                const hr = Array.from(values);
                if (hr.length < 92) {
                    throw new Error(`Expected 92 holding registers, received ${hr.length}`);
                }
                this.lastHoldingRegisters = hr;
                await this.updateTristarData(hr, adapterConfig);
            }));
        }
        catch (error) {
            this.tristarScale = undefined;
            this.solarFilter.reset();
            throw error;
        }
    }
    async readCoilStates(adapterConfig) {
        await this.enqueue(() => this.connect(adapterConfig, async (client) => {
            const response = await client.readCoils(0, 3);
            const coils = Array.from(response.response.body.valuesAsArray).slice(0, 3);
            if (coils.length < 3) {
                throw new Error(`Expected at least 3 coils, received ${coils.length}`);
            }
            for (const entry of Object.values(this.tristarData)) {
                if (entry.source === "coil" && entry.readCoil) {
                    entry.valueOld = entry.value;
                    entry.value = entry.readCoil(coils);
                    entry.initialized = true;
                }
            }
        }));
    }
    async readStaticRegisters(adapterConfig) {
        if (this.lastHoldingRegisters.length < 92) {
            throw new Error("Read RAM scaling values before static registers");
        }
        const writeVersion = this.eepromWriteVersion;
        const readScaleSignature = this.scaleSignature;
        const registers = new Map();
        const errors = [];
        for (const block of STATIC_REGISTER_BLOCKS) {
            try {
                // Only one block occupies the FIFO at a time. RAM polls and writes
                // can be interleaved between blocks instead of waiting for all blocks.
                const values = await this.enqueue(() => this.readRegisterBlock(adapterConfig, block.start, block.count));
                values.forEach((value, index) => registers.set(block.start + index, value));
            }
            catch (error) {
                errors.push(`0x${block.start.toString(16)}: ${(0, tristarMpptUtil_1.errorText)(error)}`);
            }
        }
        if (writeVersion !== this.eepromWriteVersion || readScaleSignature !== this.scaleSignature) {
            this.staticDataStale = true;
            throw new Error("EEPROM or scaling changed during static refresh; discard mixed snapshot and refresh again");
        }
        this.lastStaticRegisters = registers;
        errors.push(...this.updateStaticData(registers, adapterConfig));
        this.staticDataLoaded = errors.length === 0;
        this.staticDataStale = false;
        if (errors.length > 0) {
            throw new Error(`Some static register blocks are unavailable: ${errors.join("; ")}`);
        }
    }
    updateStaticData(registers, config) {
        const tmd = new tristarMpptModel_1.TristarModbusData(this.lastHoldingRegisters, config, null, registers);
        const errors = [];
        for (const entry of Object.values(this.tristarData)) {
            if (entry.source && entry.source !== "coil" && entry.readRegister) {
                try {
                    entry.valueOld = entry.value;
                    entry.value = entry.readRegister(tmd);
                    entry.rawValue = entry.registerAddress === undefined ? undefined : tmd.readStatic(entry.registerAddress);
                    entry.initialized = true;
                }
                catch (error) {
                    entry.value = null;
                    entry.initialized = false;
                    entry.rawValue = undefined;
                    errors.push(`${entry.descr}: ${(0, tristarMpptUtil_1.errorText)(error)}`);
                }
            }
        }
        return errors;
    }
    async readRegisterBlock(adapterConfig, start, count) {
        let result = [];
        await this.connect(adapterConfig, async (client) => {
            // Active TCP values are RAM/FC03. The EEPROM table, including its
            // network settings, is explicitly documented as input registers/FC04.
            const response = start >= 0x151b
                ? await client.readInputRegisters(start, count)
                : await client.readHoldingRegisters(start, count);
            result = Array.from(response.response.body.valuesAsArray);
            if (result.length !== count) {
                throw new Error(`Expected ${count} registers at 0x${start.toString(16)}, received ${result.length}`);
            }
        });
        return result;
    }
    async writeEepromRegister(adapterConfig, command, expectedRaw, expectedScaleSignature) {
        await this.enqueue(async () => {
            this.assertScaleSignature(expectedScaleSignature);
            let writePossiblySent = false;
            try {
                const before = await this.readRegisterBlock(adapterConfig, command.register, 1);
                if (before[0] !== expectedRaw) {
                    throw new Error(`EEPROM value at 0x${command.register.toString(16)} changed; refresh and review before writing`);
                }
                // Exactly one write. No automatic retry, clear-faults or controller reset.
                await this.connect(adapterConfig, async (client) => {
                    writePossiblySent = true;
                    await client.writeSingleRegister(command.register, command.value);
                });
                let after;
                try {
                    after = await this.readRegisterBlock(adapterConfig, command.register, 1);
                }
                catch (error) {
                    throw new Error(`EEPROM write was sent but readback failed; do not retry blindly: ${(0, tristarMpptUtil_1.errorText)(error)}`);
                }
                if (after[0] !== command.value) {
                    throw new Error(`EEPROM readback mismatch at 0x${command.register.toString(16)}: wrote ${command.value}, read ${after[0]}`);
                }
                this.lastStaticRegisters.set(command.register, after[0]);
                this.updateStaticData(this.lastStaticRegisters, adapterConfig);
            }
            finally {
                if (writePossiblySent) {
                    // Even a lost response or failed readback may leave the device changed.
                    // Invalidate any concurrently collected mixed static snapshot.
                    this.eepromWriteVersion++;
                    this.staticDataStale = true;
                }
            }
        });
    }
    async writeCoil(adapterConfig, command) {
        await this.enqueue(() => this.connect(adapterConfig, async (client) => {
            await client.writeSingleCoil(command.register, command.value === 1);
        }));
    }
    enqueue(task) {
        const result = this.operation.then(() => {
            if (this.stopping) {
                throw new Error("Modbus client is stopping");
            }
            return task();
        });
        this.operation = result.then(() => undefined, () => undefined);
        return result;
    }
    assertScaleSignature(expected) {
        if (!this.tristarScale || this.scaleSignature !== expected) {
            throw new Error("Scaling values changed or are invalid; discard command without hardware write");
        }
    }
    async connect(adapterConfig, callback) {
        if (this.stopping) {
            throw new Error("Modbus client is stopping");
        }
        return new Promise((resolve, reject) => {
            const netSocket = new net.Socket();
            this.activeSocket = netSocket;
            let settled = false;
            const finish = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                netSocket.setTimeout(0);
                if (this.activeSocket === netSocket) {
                    this.activeSocket = undefined;
                }
                if (error) {
                    netSocket.destroy();
                    reject(error);
                }
                else {
                    netSocket.end();
                    resolve();
                }
            };
            try {
                const client = new modbus.client.TCP(netSocket, adapterConfig.unitId);
                netSocket.once("error", finish);
                netSocket.once("end", () => {
                    // The TriStar may send a valid response and FIN together. Let the
                    // resolved Modbus promise finish first, then reject a bare FIN.
                    setImmediate(() => {
                        finish(new Error("Modbus peer closed the connection before the operation completed"));
                    });
                });
                netSocket.setTimeout(SOCKET_TIMEOUT_MS, () => {
                    finish(new Error(`Modbus connection timed out after ${SOCKET_TIMEOUT_MS} ms`));
                });
                netSocket.once("connect", () => {
                    callback(client).then(() => finish(), finish);
                });
                netSocket.connect({
                    host: adapterConfig.hostname,
                    port: adapterConfig.port,
                });
            }
            catch (error) {
                finish(error);
            }
        });
    }
    close() {
        this.stopping = true;
        this.solarFilter.reset();
        if (this.activeSocket) {
            this.activeSocket.destroy(new Error("Adapter is stopping"));
            this.activeSocket = undefined;
        }
    }
}
exports.TristarMpptTCPModbus = TristarMpptTCPModbus;
//# sourceMappingURL=tristarMpptTCPModbus.js.map