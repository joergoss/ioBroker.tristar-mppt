import { expect } from "chai";
import { validateConfig } from "./config";

function validConfig(): ioBroker.AdapterConfig {
	return {
		hostname: " controller.local ",
		port: 502,
		unitId: 1,
		interval: 5,
		installedWP: 0,
	} as ioBroker.AdapterConfig;
}

describe("adapter configuration", () => {
	it("normalizes legacy numeric strings and trims the hostname", () => {
		const config = validConfig();
		Object.assign(config, { interval: "2", port: "503", unitId: "2" });

		validateConfig(config);

		expect(config.hostname).to.equal("controller.local");
		expect(config.interval).to.equal(2);
		expect(config.port).to.equal(503);
		expect(config.unitId).to.equal(2);
		expect(config.enableControlWrites).to.equal(false);
		expect(config.enableEepromWrites).to.equal(false);
	});

	it("preserves an explicit EEPROM opt-in", () => {
		const config = validConfig();
		config.enableControlWrites = true;
		config.enableEepromWrites = true;
		validateConfig(config);
		expect(config.enableControlWrites).to.equal(true);
		expect(config.enableEepromWrites).to.equal(true);
	});

	it("rejects missing hostnames and values outside the documented ranges", () => {
		for (const [key, value] of Object.entries({
			hostname: "",
			port: 0,
			unitId: 248,
			interval: 0,
			installedWP: -1,
		})) {
			const config = validConfig();
			Object.assign(config, { [key]: value });
			expect(() => validateConfig(config), key).to.throw();
		}
	});
});
