import { expect } from "chai";
import { TristarModbusData, TristarModel, TristarScale } from "./tristarMpptModel";
import { to32bitNumber } from "./tristarMpptUtil";

function createRegisters(): number[] {
	const registers = new Array<number>(92).fill(0);
	registers[0] = 80;
	registers[2] = 80;
	return registers;
}

function createModbusData(registers: number[], installedWP = 2000): TristarModbusData {
	return new TristarModbusData(registers, { installedWP } as ioBroker.AdapterConfig);
}

describe("TristarScale", () => {
	it("rejects missing or zero scaling values", () => {
		const registers = new Array<number>(92).fill(0);
		expect(() => new TristarScale(registers)).to.throw("Invalid TriStar scaling values");
	});

	it("decodes the official Morningstar voltage example", () => {
		const registers = createRegisters();
		registers[0] = 123;
		registers[1] = 0xe041;
		registers[24] = 3504;

		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["batt.V"].readRegister!(data)).to.equal(13.25);
	});
});

describe("TristarModel manual control", () => {
	it("uses the fixed 80 A scaling term for Ib_ref_slave", () => {
		const registers = createRegisters();
		registers[2] = 60; // I_PU must not affect this register.
		registers[88] = 4096;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["control.IbattRefSlave"].readRegister!(data)).to.equal(10);
	});

	it("uses a single 2^-15 factor for Vb_ref_slave", () => {
		const registers = createRegisters();
		registers[89] = 4096;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["control.VbattRefSlave"].readRegister!(data)).to.equal(10);
	});

	it("roundtrips positive and negative control values as signed registers", () => {
		const registers = createRegisters();
		const scale = new TristarScale(registers);
		const model = new TristarModel();
		const currentControl = model["control.IbattRefSlave"];
		const voltageControl = model["control.VbattRefSlave"];

		expect(currentControl.writeRegister!({ value: 10, scale })).to.deep.equal({ register: 88, value: 4096 });
		expect(voltageControl.writeRegister!({ value: 10, scale })).to.deep.equal({ register: 89, value: 4096 });

		const negativeCurrent = currentControl.writeRegister!({ value: -1, scale });
		expect(negativeCurrent.value).to.equal((-410) & 0xffff);
		registers[88] = negativeCurrent.value;
		expect(currentControl.readRegister!(createModbusData(registers))).to.equal(-1);
	});

	it("rejects non-finite and out-of-range control values", () => {
		const registers = createRegisters();
		const scale = new TristarScale(registers);
		const model = new TristarModel();
		const currentControl = model["control.IbattRefSlave"];

		expect(() => currentControl.writeRegister!({ value: Number.NaN, scale })).to.throw();
		expect(() => currentControl.writeRegister!({ value: Number.POSITIVE_INFINITY, scale })).to.throw();
		expect(() => currentControl.writeRegister!({ value: 80, scale })).to.throw();
		expect(currentControl.writeRegister!({ value: 79, scale }).value).to.equal(32358);
	});
});

describe("TristarModel register mapping", () => {
	it("maps register 66 to the maximum daily array voltage", () => {
		const registers = createRegisters();
		registers[66] = 8192;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["today.solar.Vmax"].readRegister!(data)).to.equal(20);
	});

	it("decodes signed temperatures", () => {
		const registers = createRegisters();
		registers[35] = 0xfffe;
		registers[37] = 0xffff;
		registers[71] = 0xfffd;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["temp.HS"].readRegister!(data)).to.equal(-2);
		expect(model["temp.BATT"].readRegister!(data)).to.equal(-1);
		expect(model["today.batt.Tmin"].readRegister!(data)).to.equal(-3);
	});

	it("does not create a numeric percentage without installed Wp", () => {
		const registers = createRegisters();
		registers[59] = 2048;
		const model = new TristarModel();
		const data = createModbusData(registers, 0);

		expect(model["solar.InPowerPercent"].readRegister!(data)).to.equal(null);
	});

	it("calculates input power percent with installed Wp", () => {
		const registers = createRegisters();
		registers[59] = 2048;
		const model = new TristarModel();
		const data = createModbusData(registers, 2000);

		expect(model["solar.InPowerPercent"].readRegister!(data)).to.equal(5);
	});

	it("decodes power registers as unsigned 16-bit values", () => {
		const registers = createRegisters();
		registers[58] = 0x8000;
		registers[59] = 0x8000;
		registers[70] = 0x8000;
		const model = new TristarModel();
		const data = createModbusData(registers, 2000);

		expect(model["batt.OutPower"].readRegister!(data)).to.equal(1600);
		expect(model["solar.InPower"].readRegister!(data)).to.equal(1600);
		expect(model["solar.InPowerPercent"].readRegister!(data)).to.equal(80);
		expect(model["today.batt.Pmax"].readRegister!(data)).to.equal(1600);
	});

	it("maps a disconnected RTS to null instead of 128 degrees", () => {
		const registers = createRegisters();
		registers[36] = 0x80;
		const model = new TristarModel();

		expect(model["temp.RTS"].readRegister!(createModbusData(registers))).to.equal(null);
	});

	it("decodes firmware and filtered ADC supply values", () => {
		const registers = createRegisters();
		registers[4] = 0x12;
		registers[25] = 4096;
		registers[30] = 16384;
		registers[31] = 16384;
		registers[32] = 16384;
		registers[33] = 16384;
		registers[34] = 16384;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["info.firmware"].readRegister!(data)).to.equal("12");
		expect(model["adc.vbTerm"].readRegister!(data)).to.equal(10);
		expect(model["adc.p12"].readRegister!(data)).to.equal(9.306);
		expect(model["adc.p3"].readRegister!(data)).to.equal(3.3);
		expect(model["adc.pMeter"].readRegister!(data)).to.equal(9.306);
		expect(model["adc.p18"].readRegister!(data)).to.equal(1.5);
		expect(model["adc.vRef"].readRegister!(data)).to.equal(1.5);
	});

	it("decodes 32-bit amp-hour counters and sweep values", () => {
		const registers = createRegisters();
		registers[52] = 1;
		registers[53] = 0;
		registers[54] = 0;
		registers[55] = 123;
		registers[60] = 2048;
		registers[61] = 4096;
		registers[62] = 8192;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["state.AhResettable"].readRegister!(data)).to.equal(6553.6);
		expect(model["state.AhTotal"].readRegister!(data)).to.equal(12.3);
		expect(model["solar.sweep.Pmax"].readRegister!(data)).to.equal(100);
		expect(model["solar.sweep.Vmp"].readRegister!(data)).to.equal(10);
		expect(model["solar.sweep.Voc"].readRegister!(data)).to.equal(20);
	});

	it("decodes daily alarms and charge-stage timers", () => {
		const registers = createRegisters();
		registers[75] = 0;
		registers[76] = 3;
		registers[77] = 100;
		registers[78] = 200;
		registers[79] = 300;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["today.alarm"].readRegister!(data)).to.equal(JSON.stringify(["RTS open", "RTS shorted"]));
		expect(model["today.timeAbsorption"].readRegister!(data)).to.equal(100);
		expect(model["today.timeEqualize"].readRegister!(data)).to.equal(200);
		expect(model["today.timeFloat"].readRegister!(data)).to.equal(300);
	});

	it("decodes the complete 16-bit DIP register", () => {
		const model = new TristarModel();
		for (const [rawValue, expected] of [[0, "0000000000000000"], [0xff, "0000000011111111"], [0x8000, "1000000000000000"], [0xffff, "1111111111111111"]] as const) {
			const registers = createRegisters();
			registers[48] = rawValue;
			expect(model["state.dip"].readRegister!(createModbusData(registers))).to.equal(expected);
		}
	});

	it("keeps unknown enum values diagnosable", () => {
		const registers = createRegisters();
		registers[49] = 255;
		registers[50] = 254;
		const model = new TristarModel();
		const data = createModbusData(registers);

		expect(model["state.ledText"].readRegister!(data)).to.equal("UNKNOWN (255)");
		expect(model["state.charge"].readRegister!(data)).to.equal("UNKNOWN (254)");
	});

	it("uses the hourmeter word order from the register table", () => {
		const registers = createRegisters();
		registers[42] = 1;
		registers[43] = 2;
		const model = new TristarModel();

		// The v11 example swaps HI/LO labels; keep the table order until hardware
		// with a known hourmeter value proves otherwise.
		expect(model["state.hourmeter"].readRegister!(createModbusData(registers))).to.equal(65538);
	});

	it("validates and converts fixed array voltage targets", () => {
		const registers = createRegisters();
		registers[90] = 4096;
		registers[91] = 32768;
		const model = new TristarModel();
		const data = createModbusData(registers);
		const scale = new TristarScale(registers);
		const voltage = model["control.VarrayFixed"];
		const percentage = model["control.VarrayFixedPct"];

		expect(voltage.readRegister!(data)).to.equal(10);
		expect(voltage.writeRegister!({ value: 10, scale })).to.deep.equal({ register: 90, value: 4096 });
		expect(() => voltage.writeRegister!({ value: -1, scale })).to.throw();
		expect(percentage.readRegister!(data)).to.equal(50);
		expect(percentage.writeRegister!({ value: 50, scale })).to.deep.equal({ register: 91, value: 32768 });
		expect(percentage.writeRegister!({ value: 100, scale })).to.deep.equal({ register: 91, value: 65535 });
		expect(() => percentage.writeRegister!({ value: 101, scale })).to.throw();
	});
});

describe("deterministic decoder fuzzing", () => {
	it("handles 1,000 full 16-bit RAM frames without exceptions or non-finite values", () => {
		const model = new TristarModel();
		let seed = 0x5eed1234;
		const nextWord = (): number => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return seed & 0xffff;
		};
		for (let iteration = 0; iteration < 1000; iteration++) {
			const registers = new Array<number>(92).fill(0).map(() => nextWord());
			registers[0] = 1 + (nextWord() % 500);
			registers[2] = 1 + (nextWord() % 100);
			const data = createModbusData(registers);
			for (const entry of Object.values(model)) {
				if (!entry.readRegister) {
					continue;
				}
				const value = entry.readRegister(data);
				if (typeof value === "number") {
					expect(Number.isFinite(value), entry.descr).to.equal(true);
				}
			}
		}
	});
});

describe("32-bit register conversion", () => {
	it("keeps unsigned values above INT32_MAX positive", () => {
		expect(to32bitNumber(0x8000, 0)).to.equal(0x80000000);
		expect(to32bitNumber(0xffff, 0xffff)).to.equal(0xffffffff);
	});
});
