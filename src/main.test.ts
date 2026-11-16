import { expect } from "chai";
import proxyquire from "proxyquire";
import * as sinon from "sinon";
import { TristarModel, TristarScale } from "./tristarMppt/tristarMpptModel";

const { TristarMppt } = proxyquire.noCallThru()("./main", {
	"@iobroker/adapter-core": { Adapter: class {} },
}) as typeof import("./main");

function createAdapterHarness(): any {
	const registers = new Array<number>(90).fill(0);
	registers[0] = 80;
	registers[2] = 80;
	const adapter = Object.create(TristarMppt.prototype);
	adapter.tristar = {
		tristarData: new TristarModel(),
		tristarScale: new TristarScale(registers),
		lastHoldingRegisters: registers,
		readHoldingRegister: sinon.stub().resolves(),
		writeHoldingRegister: sinon.stub().resolves(),
		writeCoil: sinon.stub().resolves(),
	};
	adapter.config = { hostname: "test", port: 502, unitId: 1, interval: 5, installedWP: 0 };
	adapter.log = { debug: sinon.stub(), error: sinon.stub(), warn: sinon.stub() };
	adapter.setStateAsync = sinon.stub().resolves();
	adapter.mainLoopRunning = true;
	adapter.lastStateValues = new Map();
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
		expect(led.args[1].common.type).to.equal("number");
		expect(voltage.args[1].common.role).to.equal("value.voltage");
		expect(reset.args[1].common).to.include({ role: "button", read: false, write: true });
		expect(adapter.extendObjectAsync.calledWith("state.led")).to.equal(true);
		expect(adapter.delObjectAsync.calledWith("today.batt.Imax")).to.equal(true);
		expect(adapter.delObjectAsync.calledWith("testVariable")).to.equal(true);
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

	it("keeps the polling loop alive if info.connection cannot be written", async () => {
		const adapter = createAdapterHarness();
		adapter.tristar.readHoldingRegister.rejects(new Error("offline"));
		adapter.setStateAsync.withArgs("info.connection").rejects(new Error("database unavailable"));

		await adapter.updateStates();

		expect(adapter.log.error.called).to.equal(true);
	});
});

describe("adapter shutdown", () => {
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

	it("writes a true button command once and resets the button", async () => {
		const adapter = createAdapterHarness();

		await adapter.onStateChange("tristar-mppt.0.control.Reset", { val: true, ack: false });

		expect(adapter.tristar.writeCoil.calledOnce).to.equal(true);
		expect(adapter.tristar.writeCoil.firstCall.args[1]).to.deep.equal({ register: 255, value: 1 });
		expect(adapter.setStateAsync.calledWith("control.Reset", { val: false, ack: true })).to.equal(true);
	});
});
