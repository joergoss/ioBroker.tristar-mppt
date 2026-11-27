import { expect } from "chai";
import proxyquire from "proxyquire";
import * as sinon from "sinon";
import { TristarModel, TristarScale } from "./tristarMppt/tristarMpptModel";
import { TristarStaticModel } from "./tristarMppt/tristarMpptStaticModel";

const { TristarMppt } = proxyquire.noCallThru()("./main", {
	"@iobroker/adapter-core": { Adapter: class {} },
}) as typeof import("./main");

function createAdapterHarness(): any {
	const registers = new Array<number>(90).fill(0);
	registers[0] = 80;
	registers[2] = 80;
	const adapter = Object.create(TristarMppt.prototype);
	adapter.tristar = {
		tristarData: { ...new TristarModel(), ...new TristarStaticModel() },
		tristarScale: new TristarScale(registers),
		scaleSignature: "80,0,80,0",
		lastHoldingRegisters: registers,
		readHoldingRegister: sinon.stub().resolves(),
		readStaticRegisters: sinon.stub().resolves(),
		readCoilStates: sinon.stub().resolves(),
		writeHoldingRegister: sinon.stub().resolves(),
		writeEepromRegister: sinon.stub().resolves(),
		writeCoil: sinon.stub().resolves(),
	};
	adapter.config = { hostname: "test", port: 502, unitId: 1, interval: 5, installedWP: 0, enableControlWrites: true, enableEepromWrites: false };
	adapter.nextStaticRead = Number.MAX_SAFE_INTEGER;
	adapter.nextCoilRead = Number.MAX_SAFE_INTEGER;
	adapter.log = { debug: sinon.stub(), error: sinon.stub(), warn: sinon.stub() };
	adapter.setStateAsync = sinon.stub().resolves();
	adapter.mainLoopRunning = true;
	adapter.retryDelayMs = 1000;
	adapter.lastStateValues = new Map();
	adapter.stateWriteQueues = new Map();
	return adapter;
}

describe("adapter object definitions", () => {
	it("uses model roles, types and write flags and migrates old objects", async () => {
		const adapter = createAdapterHarness();
		adapter.setObjectNotExistsAsync = sinon.stub().resolves();
		adapter.extendObjectAsync = sinon.stub().resolves();
		adapter.delObjectAsync = sinon.stub().resolves();

		await adapter.initObjects();

		const led = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "state.led");
		const voltage = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "batt.V");
		const reset = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "control.Reset");
		const eeprom = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "eeprom.charge.absorptionV");
		expect(led.args[1].common.type).to.equal("number");
		expect(voltage.args[1].common.role).to.equal("value.voltage");
		expect(reset.args[1].common).to.include({ role: "button", read: false, write: true });
		expect(eeprom.args[1].common.write).to.equal(false);
		expect(adapter.extendObjectAsync.calledWith("state.led")).to.equal(true);
		expect(adapter.delObjectAsync.calledWith("today.batt.Imax")).to.equal(true);
		expect(adapter.delObjectAsync.calledWith("testVariable")).to.equal(true);
	});

	it("marks every control and EEPROM state read-only without opt-in", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableControlWrites = false;
		adapter.setObjectNotExistsAsync = sinon.stub().resolves();
		adapter.extendObjectAsync = sinon.stub().resolves();
		adapter.delObjectAsync = sinon.stub().resolves();

		await adapter.initObjects();

		const reset = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "control.Reset");
		const absorption = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "eeprom.charge.absorptionV");
		expect(reset.args[1].common.write).to.equal(false);
		expect(absorption.args[1].common.write).to.equal(false);
	});

	it("enables only allowlisted EEPROM states after explicit opt-in", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableEepromWrites = true;
		adapter.setObjectNotExistsAsync = sinon.stub().resolves();
		adapter.extendObjectAsync = sinon.stub().resolves();
		adapter.delObjectAsync = sinon.stub().resolves();

		await adapter.initObjects();

		const absorption = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "eeprom.charge.absorptionV");
		const hvd = adapter.setObjectNotExistsAsync.getCalls().find((call: any) => call.args[0] === "eeprom.charge.hvdV");
		expect(absorption.args[1].common.write).to.equal(true);
		expect(hvd.args[1].common.write).to.equal(false);
	});
});

describe("adapter state updates", () => {
	it("writes a real zero on the first poll and suppresses duplicate writes", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.tristarData = {
			"batt.V": { value: 0, readRegister: sinon.stub() },
		};

		await adapter.updateStates();
		await adapter.updateStates();

		expect(adapter.setStateAsync.withArgs("batt.V", { val: 0, ack: true }).callCount).to.equal(1);
		expect(adapter.setStateAsync.withArgs("info.connection", { val: true, ack: true }).callCount).to.equal(1);
	});

	it("retries a state if the previous ioBroker write failed", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.tristarData = {
			"batt.V": { value: 12, readRegister: sinon.stub() },
		};
		adapter.setStateAsync.withArgs("batt.V").onFirstCall().rejects(new Error("database unavailable"));

		await adapter.updateStates();
		await adapter.updateStates();

		expect(adapter.setStateAsync.withArgs("batt.V", { val: 12, ack: true }).callCount).to.equal(2);
	});

	it("publishes fresh RAM values without awaiting a pending static refresh", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.tristarData = {
			"batt.V": { value: 12, readRegister: sinon.stub() },
		};
		adapter.nextStaticRead = 0;
		let releaseStatic!: () => void;
		const staticGate = new Promise<void>(resolve => releaseStatic = resolve);
		adapter.tristar.readStaticRegisters.returns(staticGate);

		await adapter.updateStates();

		expect(adapter.setStateAsync.calledWith("batt.V", { val: 12, ack: true })).to.equal(true);
		expect(adapter.staticReadPromise).to.equal(staticGate);
		releaseStatic();
		await staticGate;
	});

	it("keeps RAM publishing and connection state when a static refresh fails", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.tristarData = {
			"batt.V": { value: 12, readRegister: sinon.stub() },
		};
		adapter.nextStaticRead = 0;
		adapter.tristar.readStaticRegisters.rejects(new Error("static unavailable"));

		await adapter.updateStates();

		expect(adapter.setStateAsync.calledWith("batt.V", { val: 12, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("info.connection", { val: true, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("info.connection", { val: false, ack: true })).to.equal(false);
	});

	it("keeps the polling loop alive if info.connection cannot be written", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.readHoldingRegister.rejects(new Error("offline"));
		adapter.setStateAsync.withArgs("info.connection").rejects(new Error("database unavailable"));

		await adapter.updateStates();

		expect(adapter.log.error.called).to.equal(true);
	});
});

describe("adapter error reporting and retry", () => {
	it("formats non-standard modbus errors without losing their details", async () => {
		const adapter = createAdapterHarness();
		const error = { code: 11 };
		adapter.tristar.readHoldingRegister.rejects(error);

		await adapter.updateStates();

		const message = adapter.log.error.firstCall.args[0];
		expect(message).to.contain("Could not read TriStar data:");
		expect(message).to.contain("code: 11");
		expect(message).not.to.contain("[object Object]");
	});

	it("uses bounded exponential backoff and resets it after a successful poll", async () => {
		const adapter = createAdapterHarness();
		adapter.config.interval = 1;
		const outcomes = [false, false, false, false, false, false, false, true];
		adapter.updateStates = sinon.stub().callsFake(async () => outcomes.shift() ?? true);
		const delays: number[] = [];
		adapter.sleep = sinon.stub().callsFake(async (ms: number) => {
			delays.push(ms);
			if (outcomes.length === 0) adapter.mainLoopRunning = false;
		});

		await adapter.mainLoop();

		expect(delays).to.deep.equal([1000, 2000, 4000, 8000, 16000, 32000, 60000, 1000]);
		expect(adapter.retryDelayMs).to.equal(1000);
	});
});

describe("adapter shutdown", () => {
	it("does not restart polling or subscriptions after unload during initialization", async () => {
		const adapter = createAdapterHarness();
		adapter.mainLoopRunning = false;
		adapter.unloaded = false;
		adapter.tristar.close = sinon.stub();
		let releaseInit!: () => void;
		const initGate = new Promise<void>(resolve => releaseInit = resolve);
		adapter.initObjects = sinon.stub().returns(initGate);
		adapter.setConnectionState = sinon.stub().resolves();
		adapter.subscribeStates = sinon.stub();
		adapter.mainLoop = sinon.stub().resolves();
		const callback = sinon.stub();
		const ready = adapter.onReady();
		await new Promise(resolve => setImmediate(resolve));

		adapter.onUnload(callback);
		releaseInit();
		await ready;

		expect(callback.calledOnce).to.equal(true);
		expect(adapter.tristar.close.calledOnce).to.equal(true);
		expect(adapter.subscribeStates.called).to.equal(false);
		expect(adapter.mainLoop.called).to.equal(false);
		expect(adapter.mainLoopRunning).to.equal(false);
	});

	it("stops publishing further states when unload interrupts a state write", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.close = sinon.stub();
		adapter.tristar.tristarData = {
			"batt.V": { value: 12, readRegister: sinon.stub() },
			"batt.A": { value: 1, readRegister: sinon.stub() },
		};
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>(resolve => releaseWrite = resolve);
		adapter.setStateAsync.withArgs("batt.V").returns(writeGate);
		const callback = sinon.stub();
		const update = adapter.updateStates();
		await new Promise(resolve => setImmediate(resolve));

		adapter.onUnload(callback);
		expect(callback.called).to.equal(false);
		releaseWrite();
		await update;
		await Promise.resolve();

		expect(adapter.setStateAsync.calledWith("batt.A")).to.equal(false);
		expect(callback.calledOnce).to.equal(true);
	});

	it("does not log expected static-read cancellation during unload", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.tristarData = {};
		adapter.nextStaticRead = 0;
		let rejectStatic!: (error: Error) => void;
		const staticRead = new Promise<void>((_resolve, reject) => rejectStatic = reject);
		adapter.tristar.readStaticRegisters.returns(staticRead);
		adapter.tristar.close = sinon.stub().callsFake(() => rejectStatic(new Error("Adapter is stopping")));
		await adapter.updateStates();

		adapter.onUnload(sinon.stub());
		await new Promise(resolve => setImmediate(resolve));

		expect(adapter.log.error.calledWithMatch("Could not read static TriStar registers")).to.equal(false);
	});

	it("cancels the polling sleep, closes Modbus I/O and calls back", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.close = sinon.stub();
		adapter.timeoutRef = undefined;
		adapter.wakeUp = undefined;
		const callback = sinon.stub();
		const sleeping = adapter.sleep(60000);

		adapter.onUnload(callback);
		await sleeping;

		expect(callback.calledOnce).to.equal(true);
		expect(adapter.tristar.close.calledOnce).to.equal(true);
		expect(adapter.mainLoopRunning).to.equal(false);
		expect(adapter.timeoutRef).to.equal(undefined);
	});
});

describe("adapter control commands", () => {
	it("blocks control and coil writes when the global control opt-in is disabled", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableControlWrites = false;

		await adapter.onStateChange("tristar-mppt.0.control.Reset", { val: true, ack: false });
		await adapter.onStateChange("tristar-mppt.0.control.VbattRefSlave", { val: 10, ack: false });

		expect(adapter.tristar.writeCoil.called).to.equal(false);
		expect(adapter.tristar.writeHoldingRegister.called).to.equal(false);
	});

	it("ignores acknowledged values", async () => {
		const adapter = createAdapterHarness();

		await adapter.onStateChange("tristar-mppt.0.control.VbattRefSlave", { val: 10, ack: true });

		expect(adapter.tristar.writeHoldingRegister.called).to.equal(false);
		expect(adapter.tristar.writeCoil.called).to.equal(false);
	});

	it("writes a valid register command and acknowledges it", async () => {
		const adapter = createAdapterHarness();

		await adapter.onStateChange("tristar-mppt.0.control.VbattRefSlave", { val: 10, ack: false });

		expect(adapter.tristar.writeHoldingRegister.calledOnce).to.equal(true);
		expect(adapter.tristar.writeHoldingRegister.firstCall.args[1]).to.deep.equal({ register: 89, value: 4096 });
		expect(adapter.setStateAsync.calledWith("control.VbattRefSlave", { val: 10, ack: true })).to.equal(true);
	});

	it("rejects invalid register commands without hardware I/O", async () => {
		const adapter = createAdapterHarness();

		await adapter.onStateChange("tristar-mppt.0.control.VbattRefSlave", { val: 100000, ack: false });

		expect(adapter.tristar.writeHoldingRegister.called).to.equal(false);
		expect(adapter.setStateAsync.calledWith("control.VbattRefSlave")).to.equal(false);
	});

	it("acknowledges false button states without writing a coil", async () => {
		const adapter = createAdapterHarness();

		await adapter.onStateChange("tristar-mppt.0.control.Reset", { val: false, ack: false });

		expect(adapter.tristar.writeCoil.called).to.equal(false);
		expect(adapter.setStateAsync.calledWith("control.Reset", { val: false, ack: true })).to.equal(true);
	});

	it("does not acknowledge failed hardware writes", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.writeHoldingRegister.rejects(new Error("write failed"));
		adapter.tristar.writeCoil.rejects(new Error("write failed"));

		await adapter.onStateChange("tristar-mppt.0.control.VbattRefSlave", { val: 10, ack: false });
		await adapter.onStateChange("tristar-mppt.0.control.Reset", { val: true, ack: false });

		expect(adapter.setStateAsync.calledWith("control.VbattRefSlave")).to.equal(false);
		expect(adapter.setStateAsync.calledWith("control.Reset")).to.equal(false);
	});

	it("writes a true button command once and resets the button", async () => {
		const adapter = createAdapterHarness();

		await adapter.onStateChange("tristar-mppt.0.control.Reset", { val: true, ack: false });

		expect(adapter.tristar.writeCoil.calledOnce).to.equal(true);
		expect(adapter.tristar.writeCoil.firstCall.args[1]).to.deep.equal({ register: 255, value: 1 });
		expect(adapter.setStateAsync.calledWith("control.Reset", { val: false, ack: true })).to.equal(true);
	});

	it("blocks EEPROM writes by default even with a non-acknowledged state", async () => {
		const adapter = createAdapterHarness();
		const entry = adapter.tristar.tristarData["eeprom.charge.absorptionV"];
		entry.initialized = true;
		entry.rawValue = 4096;

		await adapter.onStateChange("tristar-mppt.0.eeprom.charge.absorptionV", { val: 10, ack: false });

		expect(adapter.tristar.writeEepromRegister.called).to.equal(false);
		expect(adapter.setStateAsync.calledWith("eeprom.charge.absorptionV")).to.equal(false);
	});

	it("blocks EEPROM writes after scale invalidation until a fresh decode", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableEepromWrites = true;
		const entry = adapter.tristar.tristarData["eeprom.charge.absorptionV"];
		entry.initialized = false;
		entry.rawValue = undefined;

		await adapter.onStateChange("tristar-mppt.0.eeprom.charge.absorptionV", { val: 10, ack: false });

		expect(adapter.tristar.writeEepromRegister.called).to.equal(false);
	});

	it("does not acknowledge an EEPROM write when readback verification fails", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableEepromWrites = true;
		const entry = adapter.tristar.tristarData["eeprom.charge.absorptionV"];
		entry.initialized = true;
		entry.rawValue = 4096;
		adapter.tristar.writeEepromRegister.rejects(new Error("readback failed"));

		await adapter.onStateChange("tristar-mppt.0.eeprom.charge.absorptionV", { val: 20, ack: false });

		expect(adapter.setStateAsync.calledWith("eeprom.charge.absorptionV")).to.equal(false);
	});

	it("uses the guarded EEPROM path with expected raw value after opt-in", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableEepromWrites = true;
		const entry = adapter.tristar.tristarData["eeprom.charge.absorptionV"];
		entry.initialized = true;
		entry.rawValue = 4096;
		entry.value = 10;

		await adapter.onStateChange("tristar-mppt.0.eeprom.charge.absorptionV", { val: 10, ack: false });

		expect(adapter.tristar.writeEepromRegister.calledOnce).to.equal(true);
		expect(adapter.tristar.writeEepromRegister.firstCall.args[1]).to.deep.equal({ register: 0xe000, value: 4096 });
		expect(adapter.tristar.writeEepromRegister.firstCall.args[2]).to.equal(4096);
		expect(adapter.setStateAsync.calledWith("eeprom.charge.absorptionV", { val: 10, ack: true })).to.equal(true);
	});

	it("serializes an older poll write before a newer verified EEPROM ACK", async () => {
		const adapter = createAdapterHarness();
		adapter.config.enableEepromWrites = true;
		const key = "eeprom.charge.absorptionV";
		const entry = adapter.tristar.tristarData[key];
		entry.initialized = true;
		entry.rawValue = 4096;
		entry.value = 10;
		adapter.tristar.tristarData = { [key]: entry };
		let releaseOldWrite!: () => void;
		const oldWriteGate = new Promise<void>(resolve => releaseOldWrite = resolve);
		adapter.setStateAsync.withArgs(key).onFirstCall().returns(oldWriteGate);
		adapter.tristar.writeEepromRegister.callsFake(async () => {
			entry.value = 20;
			entry.rawValue = 8192;
		});

		const poll = adapter.updateStates();
		await new Promise(resolve => setImmediate(resolve));
		const command = adapter.onStateChange(`tristar-mppt.0.${key}`, { val: 20, ack: false });
		await new Promise(resolve => setImmediate(resolve));
		expect(adapter.setStateAsync.withArgs(key).callCount).to.equal(1);

		releaseOldWrite();
		await Promise.all([poll, command]);

		const values = adapter.setStateAsync.getCalls().filter((call: any) => call.args[0] === key).map((call: any) => call.args[1].val);
		expect(values).to.deep.equal([10, 20]);
		expect(adapter.lastStateValues.get(key)).to.equal(20);
	});
});
