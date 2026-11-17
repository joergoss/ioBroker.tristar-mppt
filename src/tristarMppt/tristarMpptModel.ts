import { SolarSnapshot } from "./solarSnapshotFilter";
import { charge_states, encodeSignedRegister, encodeUnsignedRegister, ledState, resolveAlarmBitfield, resolveFaultsBitfield, round, signedToInteger, to32bitNumber, wordString } from "./tristarMpptUtil";

export interface TristarDataEntry {
	descr: string,
	unit: string;
	role: ioBrokerRole;
	type: ioBroker.CommonType //'number' | 'string' | 'boolean' | 'array' | 'object' | 'mixed' | 'file'
	readRegister?: (tristarModbusData: TristarModbusData) => TristarPropertyType;
	readCoil?: (coils: Array<boolean | number>) => TristarPropertyType;
	writeRegister?: (twd: TristarWriteData) => TristarWriteSingleHoldingRegister;
	writeCoil?: (twd: TristarWriteData) => TristarWriteSingleCoil
	source?: "network" | "eeprom" | "coil";
	initialized?: boolean;
	rawValue?: number;
	registerAddress?: number;
	value: TristarPropertyType;
	valueOld?: TristarPropertyType;
}

export type TristarPropertyType = number | string | boolean | null; // entspricht ioBroker.StateValue
export type TristarHoldingRegisterArray = Array<number>

export interface TristarWriteData  {
	value: TristarPropertyType,
	scale: TristarScale

}
export interface TristarWriteSingleHoldingRegister {
	register: number;
	value: number
}

export interface TristarWriteSingleCoil {
	register: number;
	value: number
}
export type ioBrokerRole = "state" | "value.current" | "value.voltage" | "value" | "value.temperature" | "level" | "level.current" | "level.voltage" | "button"

export class TristarModbusData {
	hr : TristarHoldingRegisterArray;
	scale : TristarScale;
	config: ioBroker.AdapterConfig;
	filteredSolar: SolarSnapshot | null;
	additionalRegisters: Map<number, number>;

	constructor(hr: TristarHoldingRegisterArray, config: ioBroker.AdapterConfig, filteredSolar: SolarSnapshot | null = null, additionalRegisters: Map<number, number> = new Map()) {
		this.hr = hr;
		this.scale = new TristarScale(hr);
		this.config = config;
		this.filteredSolar = filteredSolar;
		this.additionalRegisters = additionalRegisters;
	}

	readStatic(address: number): number {
		const value = this.additionalRegisters.get(address);
		if (value === undefined) {
			throw new Error(`Static register 0x${address.toString(16)} has not been read`);
		}
		return value;
	}
}

export class TristarScale {
	v : number;
	i : number;
	p : number;
	constructor(hr: TristarHoldingRegisterArray) {
		const V_PU_hi = hr[0];
		const V_PU_lo = hr[1];
		const I_PU_hi = hr[2];
		const I_PU_lo = hr[3];

		const V_PU = V_PU_hi + V_PU_lo / Math.pow(2, 16);
		const I_PU = I_PU_hi + I_PU_lo / Math.pow(2, 16);
		if (!Number.isFinite(V_PU) || !Number.isFinite(I_PU) || V_PU <= 0 || I_PU <= 0) {
			throw new Error(`Invalid TriStar scaling values: V_PU=${V_PU}, I_PU=${I_PU}`);
		}

		this.v = V_PU * Math.pow(2, -15);
		this.i = I_PU * Math.pow(2, -15);
		this.p = V_PU * I_PU * Math.pow(2, -17);

	}

}

export class TristarModel {
	[key: string]: TristarDataEntry

	"info.firmware": TristarDataEntry = {
		descr: "Controller firmware version (BCD digits)",
		unit: "",
		role: "state",
		type: "string",
		readRegister: (tmd: TristarModbusData) => tmd.hr[4].toString(16).toUpperCase(),
		value: "",
	};

 	"adc.vb_f_med":    TristarDataEntry = {
		descr: "Battery voltage, filtered",
		unit:  "V",
		role:  "value.voltage",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[24]) * tmd.scale.v, 2),
		value: 0,
	};
	"adc.vbTerm": TristarDataEntry = {
		descr: "Battery terminal voltage, filtered",
		unit: "V",
		role: "value.voltage",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[25]) * tmd.scale.v, 2),
		value: 0,
	};
	"adc.p12": TristarDataEntry = {
		descr: "Internal 12 V supply, filtered",
		unit: "V",
		role: "value.voltage",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[30]) * 18.612 * Math.pow(2, -15), 3),
		value: 0,
	};
	"adc.p3": TristarDataEntry = {
		descr: "Internal 3 V supply, filtered",
		unit: "V",
		role: "value.voltage",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[31]) * 6.6 * Math.pow(2, -15), 3),
		value: 0,
	};
	"adc.pMeter": TristarDataEntry = {
		descr: "MeterBus supply voltage, filtered",
		unit: "V",
		role: "value.voltage",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[32]) * 18.612 * Math.pow(2, -15), 3),
		value: 0,
	};
	"adc.p18": TristarDataEntry = {
		descr: "Internal 1.8 V supply, filtered",
		unit: "V",
		role: "value.voltage",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[33]) * 3 * Math.pow(2, -15), 3),
		value: 0,
	};
	"adc.vRef": TristarDataEntry = {
		descr: "External reference voltage",
		unit: "V",
		role: "value.voltage",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[34]) * 3 * Math.pow(2, -15), 3),
		value: 0,
	};

	// ------------------------------------------------------------------------------------------

	"temp.HS":    TristarDataEntry = {
		descr: "Heatsink temperature",
		role:  "value.temperature",
		unit:  "°C",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => signedToInteger(tmd.hr[35]),
		value: 0,
	};
	"temp.RTS":    TristarDataEntry = {
		descr: "Remote temperature sensor (null = disconnected)",
		role:  "value.temperature",
		unit:  "°C",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[36] === 0x80 ? null : signedToInteger(tmd.hr[36]),
		value: 0,
	};
	"temp.BATT":    TristarDataEntry = {
		descr: "Battery regulation temperature",
		role:  "value.temperature",
		unit:  "°C",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => signedToInteger(tmd.hr[37]),
		value: 0,
	};

	// ------------------------------------------------------------------------------------------

	"batt.V":    TristarDataEntry = {
		descr: "Battery voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[24]) * tmd.scale.v, 2),
		value: 0,
	};

	"batt.SensedV":    TristarDataEntry = {
		descr: "Battery sensed voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[26]) * tmd.scale.v, 1),
		value: 0,
	};

	"batt.A":    TristarDataEntry = {
		descr: "Battery charge current",
		role:  "value.current",
		unit:  "A",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[28]) * tmd.scale.i, 2),
		value: 0,
	};
	"batt.OutPower":    TristarDataEntry = {
		descr: "Output power",
		role:  "value",
		unit:  "W",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(tmd.hr[58] * tmd.scale.p, 2),
		value: 0,
	};
	"batt.Vmin":    TristarDataEntry = {
		descr: "Minimum battery voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[40]) * tmd.scale.v, 2),
		value: 0,
	};
	"batt.Vmax":    TristarDataEntry = {
		descr: "Maximal battery voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[41]) * tmd.scale.v, 2),
		value: 0,
	};
	"batt.Vf1m":    TristarDataEntry = {
		descr: "Battery voltage, filtered(τ ≈ 1min)",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[38]) * tmd.scale.v, 2),
		value: 0,
	};

	"batt.Af1m":    TristarDataEntry = {
		descr: "Charging current, filtered(τ ≈ 1min)",
		role:  "value.current",
		unit:  "A",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[39]) * tmd.scale.i, 2),
		value: 0,
	};
	"batt.Vtarget":    TristarDataEntry = {
		descr: "Voltage to which the battery will be charged at any given time. This value changes with each chargestage and is temperature compensated",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[51]) * tmd.scale.v, 2),
		value: 0,
	};

	// ------------------------------------------------------------------------------------------

	"solar.V":    TristarDataEntry = {
		descr: "Array voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[27]) * tmd.scale.v, 2),
		value: 0,
	};

	"solar.I":    TristarDataEntry = {
		descr: "Array current",
		role:  "value.current",
		unit:  "A",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[29]) * tmd.scale.i, 2),
		value: 0,
	};

	"solar.InPower":    TristarDataEntry = {
		descr: "Input power",
		role:  "value",
		unit:  "W",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(tmd.hr[59] * tmd.scale.p, 0),
		value: 0,
	};

	"solar.InPowerPercent":    TristarDataEntry = {
		descr: "Input power percent of watt peak",
		role:  "value",
		unit:  "%",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.config.installedWP > 0
			? round(tmd.hr[59] * tmd.scale.p * 100 / tmd.config.installedWP, 1)
			: null,
		value: null,
	};
	"solar.IFiltered": TristarDataEntry = {
		descr: "Array current, median of three consecutive poll snapshots",
		role: "value.current",
		unit: "A",
		type: "number",
		readRegister: (tmd: TristarModbusData) => tmd.filteredSolar ? round(tmd.filteredSolar.current, 2) : null,
		value: null,
	};
	"solar.InPowerFiltered": TristarDataEntry = {
		descr: "Input power, median of three consecutive poll snapshots",
		role: "value",
		unit: "W",
		type: "number",
		readRegister: (tmd: TristarModbusData) => tmd.filteredSolar ? round(tmd.filteredSolar.power, 0) : null,
		value: null,
	};
	"solar.InPowerPercentFiltered": TristarDataEntry = {
		descr: "Filtered input power percent of installed Wp",
		role: "value",
		unit: "%",
		type: "number",
		readRegister: (tmd: TristarModbusData) => tmd.filteredSolar && tmd.config.installedWP > 0
			? round(tmd.filteredSolar.power * 100 / tmd.config.installedWP, 1)
			: null,
		value: null,
	};
	"solar.sweep.Pmax": TristarDataEntry = {
		descr: "Maximum array power found during the last sweep",
		role: "value",
		unit: "W",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(tmd.hr[60] * tmd.scale.p, 0),
		value: 0,
	};
	"solar.sweep.Vmp": TristarDataEntry = {
		descr: "Maximum power voltage found during the last sweep",
		role: "value.voltage",
		unit: "V",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[61]) * tmd.scale.v, 2),
		value: 0,
	};
	"solar.sweep.Voc": TristarDataEntry = {
		descr: "Open-circuit voltage found during the last sweep",
		role: "value.voltage",
		unit: "V",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[62]) * tmd.scale.v, 2),
		value: 0,
	};

	"state.charge":    TristarDataEntry = {
		descr: "charge state",
		role:  "state",
		unit:  "",
		type: "string",
		readRegister:  (tmd: TristarModbusData) => charge_states[tmd.hr[50]] ?? `UNKNOWN (${tmd.hr[50]})`,
		value: "",
	};
	"state.hourmeter":    TristarDataEntry = {
		descr: "hourmeter",
		role:  "state",
		unit:  "h",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => to32bitNumber(tmd.hr[42], tmd.hr[43]),
		value: 0,
	};
	"state.kWhTotal":    TristarDataEntry = {
		descr: "Reports total solar kilowatt-hours",
		role:  "state",
		unit:  "kWh",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[57],
		value: 0,
	};

	"state.kWhResetable":    TristarDataEntry = {
		descr: "Reports total solar kilowatt-hours since last ah/kWh reset",
		role:  "state",
		unit:  "kWh",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[56],
		value: 0,
	};
	"state.AhResettable": TristarDataEntry = {
		descr: "Charge amp-hours since the last reset",
		role: "state",
		unit: "Ah",
		type: "number",
		readRegister: (tmd: TristarModbusData) => to32bitNumber(tmd.hr[52], tmd.hr[53]) * 0.1,
		value: 0,
	};
	"state.AhTotal": TristarDataEntry = {
		descr: "Total charge amp-hours",
		role: "state",
		unit: "Ah",
		type: "number",
		readRegister: (tmd: TristarModbusData) => to32bitNumber(tmd.hr[54], tmd.hr[55]) * 0.1,
		value: 0,
	};

	"state.faults":    TristarDataEntry = {
		descr: "Active controller faults as a JSON array",
		role:  "state",
		unit:  "",
		type: "array",
		readRegister:  (tmd: TristarModbusData) => JSON.stringify(resolveFaultsBitfield(tmd.hr[44])),
		value: "[]",
	};


	"state.dip":    TristarDataEntry = {
		descr: "DIP switch positions as a 16-bit string",
		role:  "state",
		unit:  "",
		type: "string",
		readRegister:  (tmd: TristarModbusData) => wordString(tmd.hr[48]),
		value: "0000000000000000",
	};

	"state.led":    TristarDataEntry = {
		descr: "State of LED indications",
		role:  "state",
		unit:  "",
		type: "number",
		readRegister:  (tmd: TristarModbusData) =>tmd.hr[49],
		value: 0,
	};

	"state.ledText":    TristarDataEntry = {
		descr: "State of LED indications",
		role:  "state",
		unit:  "",
		type: "string",
		readRegister:  (tmd: TristarModbusData) => ledState[tmd.hr[49]] ?? `UNKNOWN (${tmd.hr[49]})`,
		value: "",
	};

	"state.alarm":    TristarDataEntry = {
		descr: "Active controller alarms as a JSON array",
		role:  "state",
		unit:  "",
		type: "array",
		readRegister:  (tmd: TristarModbusData) => JSON.stringify(resolveAlarmBitfield(to32bitNumber(tmd.hr[46], tmd.hr[47]))),
		value: "[]",
	};
	"state.equalizeTriggered": TristarDataEntry = {
		descr: "Equalize triggered coil status",
		role: "state",
		unit: "",
		type: "boolean",
		source: "coil",
		initialized: false,
		readCoil: coils => coils[0] === true || coils[0] === 1,
		value: null,
	};
	"state.chargeDisconnect": TristarDataEntry = {
		descr: "Charge disconnect coil status",
		role: "state",
		unit: "",
		type: "boolean",
		source: "coil",
		initialized: false,
		readCoil: coils => coils[2] === true || coils[2] === 1,
		value: null,
	};


	"today.batt.Vmin":    TristarDataEntry = {
		descr: "battery minimal voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[64]) * tmd.scale.v, 2),
		value: 0,
	};

	"today.batt.Vmax":    TristarDataEntry = {
		descr: "battery maximal voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[65]) * tmd.scale.v, 2),
		value: 0,
	};
	"today.solar.Vmax":    TristarDataEntry = {
		descr: "Maximum daily array voltage",
		role:  "value.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[66]) * tmd.scale.v, 2),
		value: 0,
	};
	"today.Ahc":    TristarDataEntry = {
		descr: "Amper hours",
		role:  "state",
		unit:  "Ah",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[67] * 0.1,
		value: 0,
	};

	"today.Whc":    TristarDataEntry = {
		descr: "watt hours",
		role:  "state",
		unit:  "Wh",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[68],
		value: 0,
	};

	"today.flags":    TristarDataEntry = {
		descr: "flags",
		role:  "state",
		unit:  "",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[69],
		value: 0,
	};

	"today.batt.Pmax":    TristarDataEntry = {
		descr: "maximal power output",
		role:  "value",
		unit:  "W",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(tmd.hr[70] * tmd.scale.p, 0),
		value: 0,
	};

	"today.batt.Tmin":    TristarDataEntry = {
		descr: "minimal battery temperature",
		role:  "value.temperature",
		unit:  "°C",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => signedToInteger(tmd.hr[71]),
		value: 0,
	};
	"today.batt.Tmax":    TristarDataEntry = {
		descr: "maximal battery temperature",
		role:  "value.temperature",
		unit:  "°C",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => signedToInteger(tmd.hr[72]),
		value: 0,
	};

	"today.fault":    TristarDataEntry = {
		descr: "Daily controller fault bitfield",
		role:  "state",
		unit:  "",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => tmd.hr[73],
		value: 0,
	};
	"today.alarm": TristarDataEntry = {
		descr: "Daily controller alarms as a JSON array",
		role: "state",
		unit: "",
		type: "array",
		readRegister: (tmd: TristarModbusData) => JSON.stringify(resolveAlarmBitfield(to32bitNumber(tmd.hr[75], tmd.hr[76]))),
		value: "[]",
	};
	"today.timeAbsorption": TristarDataEntry = {
		descr: "Cumulative time in absorption today",
		role: "state",
		unit: "s",
		type: "number",
		readRegister: (tmd: TristarModbusData) => tmd.hr[77],
		value: 0,
	};
	"today.timeEqualize": TristarDataEntry = {
		descr: "Cumulative time in equalization today",
		role: "state",
		unit: "s",
		type: "number",
		readRegister: (tmd: TristarModbusData) => tmd.hr[78],
		value: 0,
	};
	"today.timeFloat": TristarDataEntry = {
		descr: "Cumulative time in float today",
		role: "state",
		unit: "s",
		type: "number",
		readRegister: (tmd: TristarModbusData) => tmd.hr[79],
		value: 0,
	};

	"control.IbattRefSlave":    TristarDataEntry = {
		descr: "Battery current regulation override. Refresh at least every 60 seconds; a negative value disables slave control.",
		role:  "level.current",
		unit:  "A",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[88]) * 80 * Math.pow(2, -15), 2),
		writeRegister: (twd: TristarWriteData) => ({ register: 88, value: encodeSignedRegister(twd.value as number, 80 * Math.pow(2, -15)) }),
		value: 0,
	};
	"control.VbattRefSlave":    TristarDataEntry = {
		descr: "Battery voltage regulation override. Refresh at least every 60 seconds; a negative value disables slave control.",
		role:  "level.voltage",
		unit:  "V",
		type: "number",
		readRegister:  (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[89]) * tmd.scale.v, 2),
		writeRegister: (twd: TristarWriteData) => ({ register: 89, value: encodeSignedRegister(twd.value as number, twd.scale.v) }),
		value: 0,
	};
	"control.VarrayFixed": TristarDataEntry = {
		descr: "Fixed array voltage target. A non-zero value disables MPPT tracking.",
		role: "level.voltage",
		unit: "V",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(signedToInteger(tmd.hr[90]) * tmd.scale.v, 2),
		writeRegister: (twd: TristarWriteData) => {
			if ((twd.value as number) < 0) {
				throw new Error("Array voltage target must not be negative");
			}
			return { register: 90, value: encodeSignedRegister(twd.value as number, twd.scale.v) };
		},
		value: 0,
	};
	"control.VarrayFixedPct": TristarDataEntry = {
		descr: "Array voltage target as percent of Voc. A non-zero value disables MPPT tracking unless VarrayFixed is set.",
		role: "level",
		unit: "%",
		type: "number",
		readRegister: (tmd: TristarModbusData) => round(tmd.hr[91] * 100 * Math.pow(2, -16), 2),
		writeRegister: (twd: TristarWriteData) => {
			const value = twd.value as number;
			if (value < 0 || value > 100) {
				throw new Error("Array voltage percentage must be between 0 and 100");
			}
			return { register: 91, value: value === 100 ? 0xffff : encodeUnsignedRegister(value, 100 * Math.pow(2, -16)) };
		},
		value: 0,
	};

	"control.ClearFaults":    TristarDataEntry = {
		descr: "Clear controller faults",
		role:  "button",
		unit:  "",
		type: "boolean",
		writeCoil: () => ({ register: 20, value: 1 }),
		value: false,
		valueOld: false
	};

	"control.ClearAlarm":    TristarDataEntry = {
		descr: "Clear controller alarms",
		role:  "button",
		unit:  "",
		type: "boolean",
		writeCoil: () => ({ register: 21, value: 1 }),
		value: false,
		valueOld: false
	};

	"control.Reset":    TristarDataEntry = {
		descr: "Reset the controller after the Modbus response",
		role:  "button",
		unit:  "",
		type: "boolean",
		writeCoil: () => ({ register: 255, value: 1 }),
		value: false,
		valueOld: false
	};

}
