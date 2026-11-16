// Tristar MODBUS

import * as modbus from "jsmodbus";
import * as net from "net";
import { SolarSnapshotFilter } from "./solarSnapshotFilter";
import { TristarHoldingRegisterArray, TristarDataEntry, TristarModbusData, TristarModel, TristarWriteSingleCoil, TristarWriteSingleHoldingRegister, TristarScale } from "./tristarMpptModel";
import { TristarStaticModel } from "./tristarMpptStaticModel";
import { signedToInteger } from "./tristarMpptUtil";

const SOCKET_TIMEOUT_MS = 10_000;
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
] as const;

interface ModbusClient {
	readHoldingRegisters(address: number, quantity: number): Promise<{
		response: { body: { valuesAsArray: ArrayLike<number> } };
	}>;
	readInputRegisters(address: number, quantity: number): Promise<{
		response: { body: { valuesAsArray: ArrayLike<number> } };
	}>;
	readCoils(address: number, quantity: number): Promise<{
		response: { body: { valuesAsArray: ArrayLike<number | boolean> } };
	}>;
	writeSingleRegister(address: number, value: number): Promise<unknown>;
	writeSingleCoil(address: number, value: boolean): Promise<unknown>;
}

export class TristarMpptTCPModbus {
	tristarData: Record<string, TristarDataEntry> = { ...new TristarModel(), ...new TristarStaticModel() };
	tristarScale: TristarScale | undefined;
	lastHoldingRegisters: TristarHoldingRegisterArray = [];
	lastStaticRegisters = new Map<number, number>();
	staticDataLoaded = false;
	private activeSocket: net.Socket | undefined;
	private operation: Promise<void> = Promise.resolve();
	private readonly solarFilter = new SolarSnapshotFilter();
	private stopping = false;

	async updateTristarData(hr: TristarHoldingRegisterArray, config: ioBroker.AdapterConfig): Promise<void> {
		const tmd = new TristarModbusData(hr, config);
		this.tristarScale = tmd.scale;
		tmd.filteredSolar = this.solarFilter.add(hr.slice(0, 4).join(","), {
			current: signedToInteger(hr[29]) * tmd.scale.i,
			power: hr[59] * tmd.scale.p,
		});

		for (const value of Object.values(this.tristarData)) {
			const entry = value as TristarDataEntry;
			if (!entry.source && typeof entry.readRegister === "function") {
				entry.valueOld = entry.value;
				entry.value = entry.readRegister(tmd);
				entry.initialized = true;
			}
		}
	}

	async writeHoldingRegister(adapterConfig: ioBroker.AdapterConfig, command: TristarWriteSingleHoldingRegister): Promise<void> {
		await this.enqueue(() => this.connect(adapterConfig, async client => {
			await client.writeSingleRegister(command.register, command.value);
		}));
	}

	async readHoldingRegister(adapterConfig: ioBroker.AdapterConfig): Promise<void> {
		try {
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
		} catch (error) {
			this.solarFilter.reset();
			throw error;
		}
	}

	async readCoilStates(adapterConfig: ioBroker.AdapterConfig): Promise<void> {
		await this.enqueue(() => this.connect(adapterConfig, async client => {
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

	async readStaticRegisters(adapterConfig: ioBroker.AdapterConfig): Promise<void> {
		if (this.lastHoldingRegisters.length < 92) {
			throw new Error("Read RAM scaling values before static registers");
		}
		await this.enqueue(async () => {
			const registers = new Map<number, number>();
			const errors: string[] = [];
			for (const block of STATIC_REGISTER_BLOCKS) {
				try {
					const values = await this.readRegisterBlock(adapterConfig, block.start, block.count);
					values.forEach((value, index) => registers.set(block.start + index, value));
				} catch (error) {
					errors.push(`0x${block.start.toString(16)}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			this.lastStaticRegisters = registers;
			errors.push(...this.updateStaticData(registers, adapterConfig));
			this.staticDataLoaded = errors.length === 0;
			if (errors.length > 0) {
				throw new Error(`Some static register blocks are unavailable: ${errors.join("; ")}`);
			}
		});
	}

	updateStaticData(registers: Map<number, number>, config: ioBroker.AdapterConfig): string[] {
		const tmd = new TristarModbusData(this.lastHoldingRegisters, config, null, registers);
		const errors: string[] = [];
		for (const entry of Object.values(this.tristarData)) {
			if (entry.source && entry.source !== "coil" && entry.readRegister) {
				try {
					entry.valueOld = entry.value;
					entry.value = entry.readRegister(tmd);
					entry.rawValue = entry.registerAddress === undefined ? undefined : tmd.readStatic(entry.registerAddress);
					entry.initialized = true;
				} catch (error) {
					entry.initialized = false;
					entry.rawValue = undefined;
					errors.push(`${entry.descr}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
		return errors;
	}

	private async readRegisterBlock(adapterConfig: ioBroker.AdapterConfig, start: number, count: number): Promise<number[]> {
		let result: number[] = [];
		await this.connect(adapterConfig, async client => {
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

	async writeEepromRegister(adapterConfig: ioBroker.AdapterConfig, command: TristarWriteSingleHoldingRegister, expectedRaw: number): Promise<void> {
		await this.enqueue(async () => {
			const before = await this.readRegisterBlock(adapterConfig, command.register, 1);
			if (before[0] !== expectedRaw) {
				throw new Error(`EEPROM value at 0x${command.register.toString(16)} changed; refresh and review before writing`);
			}

			// Exactly one write. No automatic retry, clear-faults or controller reset.
			await this.connect(adapterConfig, async client => {
				await client.writeSingleRegister(command.register, command.value);
			});

			let after: number[];
			try {
				after = await this.readRegisterBlock(adapterConfig, command.register, 1);
			} catch (error) {
				throw new Error(`EEPROM write was sent but readback failed; do not retry blindly: ${error instanceof Error ? error.message : String(error)}`);
			}
			if (after[0] !== command.value) {
				throw new Error(`EEPROM readback mismatch at 0x${command.register.toString(16)}: wrote ${command.value}, read ${after[0]}`);
			}
			this.lastStaticRegisters.set(command.register, after[0]);
			this.updateStaticData(this.lastStaticRegisters, adapterConfig);
		});
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
			} catch (error) {
				finish(error);
			}
		});
	}

	close(): void {
		this.stopping = true;
		this.solarFilter.reset();
		if (this.activeSocket) {
			this.activeSocket.destroy(new Error("Adapter is stopping"));
			this.activeSocket = undefined;
		}
	}
}
