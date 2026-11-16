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
const tristarMpptModel_1 = require("./tristarMpptModel");
const SOCKET_TIMEOUT_MS = 10000;
class TristarMpptTCPModbus {
    constructor() {
        this.tristarData = new tristarMpptModel_1.TristarModel();
        this.lastHoldingRegisters = [];
        this.operation = Promise.resolve();
        this.stopping = false;
    }
    async updateTristarData(hr, config) {
        const tmd = new tristarMpptModel_1.TristarModbusData(hr, config);
        this.tristarScale = tmd.scale;
        for (const value of Object.values(this.tristarData)) {
            const entry = value;
            if (typeof entry.readRegister === "function") {
                entry.valueOld = entry.value;
                entry.value = entry.readRegister(tmd);
            }
        }
    }
    async writeHoldingRegister(adapterConfig, command) {
        await this.enqueue(() => this.connect(adapterConfig, async (client) => {
            await client.writeSingleRegister(command.register, command.value);
        }));
    }
    async readHoldingRegister(adapterConfig) {
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
        this.operation = result.catch(() => undefined);
        return result;
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
        if (this.activeSocket) {
            this.activeSocket.destroy(new Error("Adapter is stopping"));
            this.activeSocket = undefined;
        }
    }
}
exports.TristarMpptTCPModbus = TristarMpptTCPModbus;
//# sourceMappingURL=tristarMpptTCPModbus.js.map