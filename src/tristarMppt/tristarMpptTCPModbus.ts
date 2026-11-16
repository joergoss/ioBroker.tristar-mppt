// Tristar MODBUS

import * as modbus from "jsmodbus";
import * as net from "net";
import { TristarHoldingRegisterArray, TristarDataEntry, TristarModbusData, TristarModel, TristarWriteSingleCoil, TristarWriteSingleHoldingRegister, TristarScale } from "./tristarMpptModel";

const SOCKET_TIMEOUT_MS = 10_000;

interface ModbusClient {
	readHoldingRegisters(address: number, quantity: number): Promise<{
		response: { body: { valuesAsArray: ArrayLike<number> } };
	}>;
	writeSingleRegister(address: number, value: number): Promise<unknown>;
	writeSingleCoil(address: number, value: boolean): Promise<unknown>;
}

export class TristarMpptTCPModbus {
	tristarData = new TristarModel();
	tristarScale: TristarScale | undefined;
	lastHoldingRegisters: TristarHoldingRegisterArray = [];
	private activeSocket: net.Socket | undefined;
	private operation: Promise<void> = Promise.resolve();
	private stopping = false;

	async updateTristarData(hr: TristarHoldingRegisterArray, config: ioBroker.AdapterConfig): Promise<void> {
		const tmd = new TristarModbusData(hr, config);
		this.tristarScale = tmd.scale;

		for (const value of Object.values(this.tristarData)) {
			const entry = value as TristarDataEntry;
			if (typeof entry.readRegister === "function") {
				entry.valueOld = entry.value;
				entry.value = entry.readRegister(tmd);
			}
		}
	}

	async writeHoldingRegister(adapterConfig: ioBroker.AdapterConfig, command: TristarWriteSingleHoldingRegister): Promise<void> {
		await this.enqueue(() => this.connect(adapterConfig, async client => {
			await client.writeSingleRegister(command.register, command.value);
		}));
	}

	async readHoldingRegister(adapterConfig: ioBroker.AdapterConfig): Promise<void> {
		await this.enqueue(() => this.connect(adapterConfig, async client => {
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

	async writeCoil(adapterConfig: ioBroker.AdapterConfig, command: TristarWriteSingleCoil): Promise<void> {
		await this.enqueue(() => this.connect(adapterConfig, async client => {
			await client.writeSingleCoil(command.register, command.value === 1);
		}));
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		const result = this.operation.then(() => {
			if (this.stopping) {
				throw new Error("Modbus client is stopping");
			}
			return task();
		});
		this.operation = result.catch(() => undefined);
		return result;
	}

	private async connect(adapterConfig: ioBroker.AdapterConfig, callback: (client: ModbusClient) => Promise<void>): Promise<void> {
		if (this.stopping) {
			throw new Error("Modbus client is stopping");
		}

		return new Promise<void>((resolve, reject) => {
			const netSocket = new net.Socket();
			this.activeSocket = netSocket;
			let settled = false;

			const finish = (error?: unknown): void => {
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
				} else {
					netSocket.end();
					resolve();
				}
			};

			try {
				const client = new modbus.client.TCP(netSocket, adapterConfig.unitId) as ModbusClient;
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
			} catch (error) {
				finish(error);
			}
		});
	}

	close(): void {
		this.stopping = true;
		if (this.activeSocket) {
			this.activeSocket.destroy(new Error("Adapter is stopping"));
			this.activeSocket = undefined;
		}
	}
}
