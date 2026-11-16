/*
 * Created with @iobroker/create-adapter v2.0.1
 */

import * as utils from "@iobroker/adapter-core";
import { validateConfig } from "./config";
import { TristarDataEntry, TristarPropertyType, TristarWriteData } from "./tristarMppt/tristarMpptModel";
import { TristarMpptTCPModbus } from "./tristarMppt/tristarMpptTCPModbus";
import { splitIdFromAdapter } from "./tristarMppt/tristarMpptUtil";

const STATIC_READ_INTERVAL_MS = 300_000;
const COIL_READ_INTERVAL_MS = 5_000;

export class TristarMppt extends utils.Adapter {
	tristar = new TristarMpptTCPModbus();
	private mainLoopRunning = false;
	private timeoutRef: ReturnType<typeof setTimeout> | undefined;
	private wakeUp: (() => void) | undefined;
	private connectionState: boolean | undefined;
	private activeUpdate: Promise<void> | undefined;
	private nextStaticRead = 0;
	private nextCoilRead = 0;
	private unloaded = false;
	private staticReadPromise: Promise<void> | undefined;
	private coilReadPromise: Promise<void> | undefined;
	private readonly stateWriteQueues = new Map<string, Promise<void>>();
	private readonly lastStateValues = new Map<string, TristarPropertyType>();

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "tristar-mppt",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	private async onReady(): Promise<void> {
		if (this.unloaded) {
			return;
		}
		await this.initObjects();
		if (this.unloaded) {
			return;
		}
		await this.setConnectionState(false);
		if (this.unloaded) {
			return;
		}

		try {
			validateConfig(this.config);
		} catch (error) {
			this.log.error(`Invalid configuration: ${this.errorText(error)}`);
			return;
		}

		if (this.unloaded) {
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

	private async initObjects(): Promise<void> {
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

		const channels = new Set<string>();
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

	private async createOrUpdateState(key: string, entry: TristarDataEntry): Promise<void> {
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

	private updateStates(): Promise<void> {
		const update = this.performUpdateStates();
		this.activeUpdate = update;
		const clear = (): void => {
			if (this.activeUpdate === update) {
				this.activeUpdate = undefined;
			}
		};
		void update.then(clear, clear);
		return update;
	}

	private async performUpdateStates(): Promise<void> {
		try {
			await this.tristar.readHoldingRegister(this.config);
		} catch (error) {
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

		// Publish fresh RAM values before optional background work. Static and
		// coil refreshes must never delay this poll.
		for (const [key, entry] of Object.entries(this.tristar.tristarData)) {
			if (!this.mainLoopRunning) {
				return;
			}
			if (!entry.readRegister && !entry.readCoil) {
				continue;
			}
			const value = entry.value;
			if (!this.lastStateValues.has(key) || this.lastStateValues.get(key) !== value) {
				try {
					this.log.debug(`${key}: ${JSON.stringify(value)}`);
					await this.writeState(key, { val: value, ack: true });
					this.lastStateValues.set(key, value);
				} catch (error) {
					this.log.error(`Could not publish ${key}: ${this.errorText(error)}`);
				}
			}
		}

		if (this.mainLoopRunning && (this.tristar.staticDataStale || Date.now() >= this.nextStaticRead)) {
			this.refreshStaticRegisters();
		}
		if (this.mainLoopRunning && Date.now() >= this.nextCoilRead) {
			this.refreshCoilStates();
		}
	}

	private refreshStaticRegisters(): void {
		if (this.staticReadPromise) {
			return;
		}
		const refresh = this.tristar.readStaticRegisters(this.config);
		this.staticReadPromise = refresh;
		const clear = (): void => {
			if (this.staticReadPromise === refresh) {
				this.staticReadPromise = undefined;
			}
		};
		void refresh.then(() => {
			clear();
			this.nextStaticRead = Date.now() + STATIC_READ_INTERVAL_MS;
		}, error => {
			clear();
			if (this.mainLoopRunning) {
				this.nextStaticRead = Date.now() + 60_000;
				this.log.error(`Could not read static TriStar registers: ${this.errorText(error)}`);
			}
		});
	}

	private refreshCoilStates(): void {
		if (this.coilReadPromise) {
			return;
		}
		const refresh = this.tristar.readCoilStates(this.config);
		this.coilReadPromise = refresh;
		const clear = (): void => {
			if (this.coilReadPromise === refresh) {
				this.coilReadPromise = undefined;
			}
		};
		void refresh.then(() => {
			clear();
			this.nextCoilRead = Date.now() + COIL_READ_INTERVAL_MS;
		}, error => {
			clear();
			if (this.mainLoopRunning) {
				this.nextCoilRead = Date.now() + 60_000;
				this.log.error(`Could not read TriStar coil states: ${this.errorText(error)}`);
			}
		});
	}

	private writeState(key: string, state: { val: ioBroker.StateValue; ack: boolean }): Promise<void> {
		const previous = this.stateWriteQueues.get(key) ?? Promise.resolve();
		const write = previous.catch(() => undefined).then(() => this.setStateAsync(key, state));
		const result = write.then(() => undefined);
		const tracked = result.then(() => undefined, () => undefined);
		this.stateWriteQueues.set(key, tracked);
		void tracked.then(() => {
			if (this.stateWriteQueues.get(key) === tracked) {
				this.stateWriteQueues.delete(key);
			}
		});
		return result;
	}

	private async setConnectionState(connected: boolean): Promise<void> {
		if (this.connectionState !== connected) {
			await this.writeState("info.connection", { val: connected, ack: true });
			this.connectionState = connected;
		}
	}

	private async safeSetConnectionState(connected: boolean): Promise<void> {
		try {
			await this.setConnectionState(connected);
		} catch (error) {
			this.log.error(`Could not update info.connection: ${this.errorText(error)}`);
		}
	}

	private onUnload(callback: () => void): void {
		this.unloaded = true;
		this.mainLoopRunning = false;
		if (this.timeoutRef) {
			clearTimeout(this.timeoutRef);
			this.timeoutRef = undefined;
		}
		const wakeUp = this.wakeUp;
		this.wakeUp = undefined;
		wakeUp?.();
		this.tristar.close();

		let completed = false;
		let unloadTimeout: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
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
		} else {
			done();
		}
	}

	private async mainLoop(): Promise<void> {
		while (this.mainLoopRunning) {
			await this.updateStates();
			if (this.mainLoopRunning) {
				await this.sleep(this.config.interval * 1000);
			}
		}
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise(resolve => {
			this.wakeUp = resolve;
			this.timeoutRef = setTimeout(() => {
				this.timeoutRef = undefined;
				this.wakeUp = undefined;
				resolve();
			}, ms);
		});
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack || !this.mainLoopRunning) {
			return;
		}

		const key = splitIdFromAdapter(id);
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
				if (!this.tristar.tristarScale || !this.tristar.scaleSignature) {
					throw new Error("Scaling values are not available yet; wait for a successful poll");
				}
				const scaleSignature = this.tristar.scaleSignature;
				const writeData: TristarWriteData = { value: state.val, scale: this.tristar.tristarScale };
				const command = entry.writeRegister(writeData);
				if (entry.source === "eeprom") {
					if (this.config.enableEepromWrites !== true) {
						throw new Error("EEPROM writes are disabled; enable them explicitly in the adapter settings");
					}
					if (entry.initialized !== true || entry.rawValue === undefined) {
						throw new Error("EEPROM value has not been read yet; wait for the static register refresh");
					}
					const previousRaw = entry.rawValue;
					await this.tristar.writeEepromRegister(this.config, command, previousRaw, scaleSignature);
					const verifiedValue = entry.value;
					await this.writeState(key, { val: verifiedValue, ack: true });
					this.lastStateValues.set(key, verifiedValue);
					this.log.info(`EEPROM ${key}: raw ${previousRaw} -> ${command.value}, readback verified; controller reset is required to clear the EEPROM-changed fault`);
				} else {
					await this.tristar.writeHoldingRegister(this.config, command, scaleSignature);
					await this.writeState(key, { val: state.val, ack: true });
				}
				return;
			}

			if (entry.writeCoil) {
				if (typeof state.val !== "boolean") {
					throw new Error("Coil command must be boolean");
				}
				if (!state.val) {
					await this.writeState(key, { val: false, ack: true });
					return;
				}
				const command = entry.writeCoil({ value: true, scale: this.tristar.tristarScale! });
				await this.tristar.writeCoil(this.config, command);
				await this.writeState(key, { val: false, ack: true });
				return;
			}
			this.log.warn(`Ignoring write to read-only state ${key}`);
		} catch (error) {
			this.log.error(`Could not write ${key}: ${this.errorText(error)}`);
		}
	}

	private errorText(error: unknown): string {
		if (error instanceof Error) {
			return error.stack || error.message;
		}
		return String(error);
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new TristarMppt(options);
	module.exports.TristarMppt = TristarMppt;
} else {
	// otherwise start the instance directly
	(() => new TristarMppt())();
}
