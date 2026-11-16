/*
 * Created with @iobroker/create-adapter v2.0.1
 */

import * as utils from "@iobroker/adapter-core";
import { validateConfig } from "./config";
import { TristarDataEntry, TristarPropertyType, TristarWriteData } from "./tristarMppt/tristarMpptModel";
import { TristarMpptTCPModbus } from "./tristarMppt/tristarMpptTCPModbus";
import { splitIdFromAdapter } from "./tristarMppt/tristarMpptUtil";

export class TristarMppt extends utils.Adapter {
	tristar = new TristarMpptTCPModbus();
	private mainLoopRunning = false;
	private timeoutRef: ReturnType<typeof setTimeout> | undefined;
	private wakeUp: (() => void) | undefined;
	private connectionState: boolean | undefined;
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
		await this.initObjects();
		await this.setConnectionState(false);

		try {
			validateConfig(this.config);
		} catch (error) {
			this.log.error(`Invalid configuration: ${this.errorText(error)}`);
			return;
		}

		this.subscribeStates("control.*");
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
		const writable = Boolean(entry.writeRegister || entry.writeCoil);
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

	private async updateStates(): Promise<void> {
		try {
			await this.tristar.readHoldingRegister(this.config);
			if (!this.mainLoopRunning) {
				return;
			}
			this.log.debug(`Raw holding registers: ${JSON.stringify(this.tristar.lastHoldingRegisters)}`);
			for (const [key, entry] of Object.entries(this.tristar.tristarData)) {
				if (!entry.readRegister) {
					continue;
				}
				if (!this.lastStateValues.has(key) || this.lastStateValues.get(key) !== entry.value) {
					this.log.debug(`${key}: ${JSON.stringify(entry.value)}`);
					await this.setStateAsync(key, { val: entry.value, ack: true });
					this.lastStateValues.set(key, entry.value);
				}
			}
			await this.setConnectionState(true);
		} catch (error) {
			if (this.mainLoopRunning) {
				try {
					await this.setConnectionState(false);
				} catch (connectionStateError) {
					this.log.error(`Could not update info.connection: ${this.errorText(connectionStateError)}`);
				}
				this.log.error(`Could not update TriStar data: ${this.errorText(error)}`);
			}
		}
	}

	private async setConnectionState(connected: boolean): Promise<void> {
		if (this.connectionState !== connected) {
			await this.setStateAsync("info.connection", { val: connected, ack: true });
			this.connectionState = connected;
		}
	}

	private onUnload(callback: () => void): void {
		this.mainLoopRunning = false;
		if (this.timeoutRef) {
			clearTimeout(this.timeoutRef);
			this.timeoutRef = undefined;
		}
		const wakeUp = this.wakeUp;
		this.wakeUp = undefined;
		wakeUp?.();
		this.tristar.close();
		callback();
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

		try {
			if (entry.writeRegister) {
				if (typeof state.val !== "number" || !Number.isFinite(state.val)) {
					throw new Error("Control value must be a finite number");
				}
				if (!this.tristar.tristarScale) {
					throw new Error("Scaling values are not available yet; wait for a successful poll");
				}
				const writeData: TristarWriteData = { value: state.val, scale: this.tristar.tristarScale };
				const command = entry.writeRegister(writeData);
				await this.tristar.writeHoldingRegister(this.config, command);
				await this.setStateAsync(key, { val: state.val, ack: true });
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
				const command = entry.writeCoil({ value: true, scale: this.tristar.tristarScale! });
				await this.tristar.writeCoil(this.config, command);
				await this.setStateAsync(key, { val: false, ack: true });
			}
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
