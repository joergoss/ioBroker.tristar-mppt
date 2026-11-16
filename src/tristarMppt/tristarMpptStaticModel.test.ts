import { expect } from "chai";
import { TristarModbusData, TristarScale } from "./tristarMpptModel";
import { TristarStaticModel } from "./tristarMpptStaticModel";

function staticData(registers: Map<number, number>): TristarModbusData {
	const hr = new Array<number>(92).fill(0);
	hr[0] = 80;
	hr[2] = 80;
	return new TristarModbusData(hr, { installedWP: 0 } as ioBroker.AdapterConfig, null, registers);
}

function fullRegisterMap(): Map<number, number> {
	const registers = new Map<number, number>();
	const ranges = [[0x1000, 0x1030], [0x151b, 0x1522], [0xe000, 0xe021], [0xe080, 0xe08c], [0xe0c0, 0xe0c3], [0xe0cc, 0xe0cd]];
	for (const [start, end] of ranges) {
		for (let address = start; address <= end; address++) {
			registers.set(address, 0);
		}
	}
	return registers;
}

describe("TristarStaticModel", () => {
	it("decodes and encodes allowlisted charging values", () => {
		const model = new TristarStaticModel();
		const registers = fullRegisterMap();
		registers.set(0xe000, 4096);
		registers.set(0xe002, 65535);
		registers.set(0xe008, 255);
		registers.set(0xe00d, 25);
		const data = staticData(registers);
		const scale = new TristarScale(data.hr);

		expect(model["eeprom.charge.absorptionV"].readRegister!(data)).to.equal(10);
		expect(model["eeprom.charge.absorptionV"].writeRegister!({ value: 10, scale })).to.deep.equal({ register: 0xe000, value: 4096 });
		expect(model["eeprom.charge.floatV"].writeRegister!({ value: 0, scale }).value).to.equal(0);
		expect(model["eeprom.charge.absorptionTime"].readRegister!(data)).to.equal(65535);
		expect(model["eeprom.charge.equalizeCalendarDays"].readRegister!(data)).to.equal(255);
		expect(model["eeprom.charge.temperatureCompensation"].readRegister!(data)).to.equal(0.03052);
		expect(model["eeprom.charge.temperatureCompensation"].writeRegister!({ value: 0.03052, scale }).value).to.equal(25);
		expect(() => model["eeprom.charge.absorptionV"].writeRegister!({ value: -1, scale })).to.throw();
		expect(() => model["eeprom.charge.equalizeCalendarDays"].writeRegister!({ value: 256, scale })).to.throw();
		expect(() => model["eeprom.charge.absorptionTime"].writeRegister!({ value: 1.5, scale })).to.throw();
	});

	it("decodes packed network values with low byte first", () => {
		const model = new TristarStaticModel();
		const registers = fullRegisterMap();
		registers.set(0x100f, 0xa8c0);
		registers.set(0x1010, 0xfd01);
		registers.set(0x1025, 0x4000);
		registers.set(0x1026, 0x0201);
		registers.set(0x1027, 0x0403);
		registers.set(0x1028, 0x0605);
		registers.set(0x101d, 0x4241);
		const data = staticData(registers);

		expect(model["network.ip"].readRegister!(data)).to.equal("192.168.1.253");
		expect(model["network.dhcpEnabled"].readRegister!(data)).to.equal(true);
		expect(model["network.mac"].readRegister!(data)).to.equal("01:02:03:04:05:06");
		expect(model["network.controllerId"].readRegister!(data)).to.equal("AB");
	});

	it("decodes EEPROM history with LO word first and identity fields", () => {
		const model = new TristarStaticModel();
		const registers = fullRegisterMap();
		registers.set(0xe080, 0x13d8);
		registers.set(0xe081, 0x0022);
		registers.set(0xe082, 123);
		registers.set(0xe083, 0);
		registers.set(0xe0c0, 0x3130);
		registers.set(0xe0c1, 0x3332);
		registers.set(0xe0c2, 0x3534);
		registers.set(0xe0c3, 0x3736);
		registers.set(0xe0cc, 1);
		registers.set(0xe0cd, 0x0102);
		const data = staticData(registers);

		expect(model["eeprom.history.hourmeter"].readRegister!(data)).to.equal(2233304);
		expect(model["eeprom.history.ahResettable"].readRegister!(data)).to.equal(12.3);
		expect(model["eeprom.info.serial"].readRegister!(data)).to.equal("01234567");
		expect(model["eeprom.info.model"].readRegister!(data)).to.equal("TS-MPPT-60");
		expect(model["eeprom.info.hardwareVersion"].readRegister!(data)).to.equal("1.2");
	});

	it("executes every static decoder and exposes no reserved primary register", () => {
		const model = new TristarStaticModel();
		const data = staticData(fullRegisterMap());
		const reserved = new Set([0xe00c, 0xe013, 0xe014, 0xe01b, 0xe01c, 0xe01e, 0xe01f]);
		const entries = Object.values(model);
		expect(entries).to.have.length(58);

		for (const entry of entries) {
			expect(entry.readRegister, entry.descr).to.be.a("function");
			expect(() => entry.readRegister!(data), entry.descr).not.to.throw();
			expect(reserved.has(entry.registerAddress!), entry.descr).to.equal(false);
		}
	});

	it("roundtrips every allowlisted EEPROM write using a representative raw value", () => {
		const model = new TristarStaticModel();
		for (const entry of Object.values(model).filter(item => item.writeRegister)) {
			const address = entry.registerAddress!;
			const rawValue = address === 0xe00d || address === 0xe008 ? 25 : 4096;
			const registers = fullRegisterMap();
			registers.set(address, rawValue);
			const data = staticData(registers);
			const scale = new TristarScale(data.hr);
			const decoded = entry.readRegister!(data);
			expect(decoded, entry.descr).to.be.a("number");
			expect(entry.writeRegister!({ value: decoded, scale }).value, entry.descr).to.equal(rawValue);
		}
	});

	it("keeps dangerous and lockout-capable registers outside the write allowlist", () => {
		const model = new TristarStaticModel();
		const writable = Object.values(model).filter(entry => entry.writeRegister).map(entry => entry.registerAddress);
		const expected = [0xe000, 0xe001, 0xe002, 0xe003, 0xe004, 0xe005, 0xe006, 0xe007, 0xe008, 0xe009, 0xe00a, 0xe00b, 0xe00d];

		expect(writable).to.deep.equal(expected);
		for (const id of ["eeprom.charge.hvdV", "eeprom.charge.hvrV", "eeprom.charge.currentLimitA", "eeprom.charge.arrayFixedV", "eeprom.network.modbusPort"]) {
			expect(model[id].writeRegister, id).to.equal(undefined);
		}
	});
});
