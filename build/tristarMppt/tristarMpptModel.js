"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TristarModel = exports.TristarScale = exports.TristarModbusData = void 0;
const tristarMpptUtil_1 = require("./tristarMpptUtil");
class TristarModbusData {
    constructor(hr, config, filteredSolar = null, additionalRegisters = new Map()) {
        this.hr = hr;
        this.scale = new TristarScale(hr);
        this.config = config;
        this.filteredSolar = filteredSolar;
        this.additionalRegisters = additionalRegisters;
    }
    readStatic(address) {
        const value = this.additionalRegisters.get(address);
        if (value === undefined) {
            throw new Error(`Static register 0x${address.toString(16)} has not been read`);
        }
        return value;
    }
}
exports.TristarModbusData = TristarModbusData;
class TristarScale {
    constructor(hr) {
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
exports.TristarScale = TristarScale;
class TristarModel {
    constructor() {
        this["info.firmware"] = {
            descr: "Controller firmware version (BCD digits)",
            unit: "",
            role: "state",
            type: "string",
            readRegister: (tmd) => tmd.hr[4].toString(16).toUpperCase(),
            value: "",
        };
        this["adc.vb_f_med"] = {
            descr: "Battery voltage, filtered",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[24]) * tmd.scale.v, 2),
            value: 0,
        };
        this["adc.vbTerm"] = {
            descr: "Battery terminal voltage, filtered",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[25]) * tmd.scale.v, 2),
            value: 0,
        };
        this["adc.p12"] = {
            descr: "Internal 12 V supply, filtered",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[30]) * 18.612 * Math.pow(2, -15), 3),
            value: 0,
        };
        this["adc.p3"] = {
            descr: "Internal 3 V supply, filtered",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[31]) * 6.6 * Math.pow(2, -15), 3),
            value: 0,
        };
        this["adc.pMeter"] = {
            descr: "MeterBus supply voltage, filtered",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[32]) * 18.612 * Math.pow(2, -15), 3),
            value: 0,
        };
        this["adc.p18"] = {
            descr: "Internal 1.8 V supply, filtered",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[33]) * 3 * Math.pow(2, -15), 3),
            value: 0,
        };
        this["adc.vRef"] = {
            descr: "External reference voltage",
            unit: "V",
            role: "value.voltage",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[34]) * 3 * Math.pow(2, -15), 3),
            value: 0,
        };
        // ------------------------------------------------------------------------------------------
        this["temp.HS"] = {
            descr: "Heatsink temperature",
            role: "value.temperature",
            unit: "°C",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.signedToInteger)(tmd.hr[35]),
            value: 0,
        };
        this["temp.RTS"] = {
            descr: "Remote temperature sensor (null = disconnected)",
            role: "value.temperature",
            unit: "°C",
            type: "number",
            readRegister: (tmd) => tmd.hr[36] === 0x80 ? null : (0, tristarMpptUtil_1.signedToInteger)(tmd.hr[36]),
            value: 0,
        };
        this["temp.BATT"] = {
            descr: "Battery regulation temperature",
            role: "value.temperature",
            unit: "°C",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.signedToInteger)(tmd.hr[37]),
            value: 0,
        };
        // ------------------------------------------------------------------------------------------
        this["batt.V"] = {
            descr: "Battery voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[24]) * tmd.scale.v, 2),
            value: 0,
        };
        this["batt.SensedV"] = {
            descr: "Battery sensed voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[26]) * tmd.scale.v, 1),
            value: 0,
        };
        this["batt.A"] = {
            descr: "Battery charge current",
            role: "value.current",
            unit: "A",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[28]) * tmd.scale.i, 2),
            value: 0,
        };
        this["batt.OutPower"] = {
            descr: "Output power",
            role: "value",
            unit: "W",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)(tmd.hr[58] * tmd.scale.p, 2),
            value: 0,
        };
        this["batt.Vmin"] = {
            descr: "Minimum battery voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[40]) * tmd.scale.v, 2),
            value: 0,
        };
        this["batt.Vmax"] = {
            descr: "Maximal battery voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[41]) * tmd.scale.v, 2),
            value: 0,
        };
        this["batt.Vf1m"] = {
            descr: "Battery voltage, filtered(τ ≈ 1min)",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[38]) * tmd.scale.v, 2),
            value: 0,
        };
        this["batt.Af1m"] = {
            descr: "Charging current, filtered(τ ≈ 1min)",
            role: "value.current",
            unit: "A",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[39]) * tmd.scale.i, 2),
            value: 0,
        };
        this["batt.Vtarget"] = {
            descr: "Voltage to which the battery will be charged at any given time. This value changes with each chargestage and is temperature compensated",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[51]) * tmd.scale.v, 2),
            value: 0,
        };
        // ------------------------------------------------------------------------------------------
        this["solar.V"] = {
            descr: "Array voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[27]) * tmd.scale.v, 2),
            value: 0,
        };
        this["solar.I"] = {
            descr: "Array current",
            role: "value.current",
            unit: "A",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[29]) * tmd.scale.i, 2),
            value: 0,
        };
        this["solar.InPower"] = {
            descr: "Input power",
            role: "value",
            unit: "W",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)(tmd.hr[59] * tmd.scale.p, 0),
            value: 0,
        };
        this["solar.InPowerPercent"] = {
            descr: "Input power percent of watt peak",
            role: "value",
            unit: "%",
            type: "number",
            readRegister: (tmd) => tmd.config.installedWP > 0
                ? (0, tristarMpptUtil_1.round)(tmd.hr[59] * tmd.scale.p * 100 / tmd.config.installedWP, 1)
                : null,
            value: null,
        };
        this["solar.IFiltered"] = {
            descr: "Array current, median of three consecutive poll snapshots",
            role: "value.current",
            unit: "A",
            type: "number",
            readRegister: (tmd) => tmd.filteredSolar ? (0, tristarMpptUtil_1.round)(tmd.filteredSolar.current, 2) : null,
            value: null,
        };
        this["solar.InPowerFiltered"] = {
            descr: "Input power, median of three consecutive poll snapshots",
            role: "value",
            unit: "W",
            type: "number",
            readRegister: (tmd) => tmd.filteredSolar ? (0, tristarMpptUtil_1.round)(tmd.filteredSolar.power, 0) : null,
            value: null,
        };
        this["solar.InPowerPercentFiltered"] = {
            descr: "Filtered input power percent of installed Wp",
            role: "value",
            unit: "%",
            type: "number",
            readRegister: (tmd) => tmd.filteredSolar && tmd.config.installedWP > 0
                ? (0, tristarMpptUtil_1.round)(tmd.filteredSolar.power * 100 / tmd.config.installedWP, 1)
                : null,
            value: null,
        };
        this["solar.sweep.Pmax"] = {
            descr: "Maximum array power found during the last sweep",
            role: "value",
            unit: "W",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)(tmd.hr[60] * tmd.scale.p, 0),
            value: 0,
        };
        this["solar.sweep.Vmp"] = {
            descr: "Maximum power voltage found during the last sweep",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[61]) * tmd.scale.v, 2),
            value: 0,
        };
        this["solar.sweep.Voc"] = {
            descr: "Open-circuit voltage found during the last sweep",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[62]) * tmd.scale.v, 2),
            value: 0,
        };
        this["state.charge"] = {
            descr: "charge state",
            role: "state",
            unit: "",
            type: "string",
            readRegister: (tmd) => { var _a; return (_a = tristarMpptUtil_1.charge_states[tmd.hr[50]]) !== null && _a !== void 0 ? _a : `UNKNOWN (${tmd.hr[50]})`; },
            value: "",
        };
        this["state.hourmeter"] = {
            descr: "hourmeter",
            role: "state",
            unit: "h",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.to32bitNumber)(tmd.hr[42], tmd.hr[43]),
            value: 0,
        };
        this["state.kWhTotal"] = {
            descr: "Reports total solar kilowatt-hours",
            role: "state",
            unit: "kWh",
            type: "number",
            readRegister: (tmd) => tmd.hr[57],
            value: 0,
        };
        this["state.kWhResetable"] = {
            descr: "Reports total solar kilowatt-hours since last ah/kWh reset",
            role: "state",
            unit: "kWh",
            type: "number",
            readRegister: (tmd) => tmd.hr[56],
            value: 0,
        };
        this["state.AhResettable"] = {
            descr: "Charge amp-hours since the last reset",
            role: "state",
            unit: "Ah",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.to32bitNumber)(tmd.hr[52], tmd.hr[53]) * 0.1,
            value: 0,
        };
        this["state.AhTotal"] = {
            descr: "Total charge amp-hours",
            role: "state",
            unit: "Ah",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.to32bitNumber)(tmd.hr[54], tmd.hr[55]) * 0.1,
            value: 0,
        };
        this["state.faults"] = {
            descr: "Active controller faults as a JSON array",
            role: "state",
            unit: "",
            type: "array",
            readRegister: (tmd) => JSON.stringify((0, tristarMpptUtil_1.resolveFaultsBitfield)(tmd.hr[44])),
            value: "[]",
        };
        this["state.dip"] = {
            descr: "DIP switch positions as a 16-bit string",
            role: "state",
            unit: "",
            type: "string",
            readRegister: (tmd) => (0, tristarMpptUtil_1.wordString)(tmd.hr[48]),
            value: "0000000000000000",
        };
        this["state.led"] = {
            descr: "State of LED indications",
            role: "state",
            unit: "",
            type: "number",
            readRegister: (tmd) => tmd.hr[49],
            value: 0,
        };
        this["state.ledText"] = {
            descr: "State of LED indications",
            role: "state",
            unit: "",
            type: "string",
            readRegister: (tmd) => { var _a; return (_a = tristarMpptUtil_1.ledState[tmd.hr[49]]) !== null && _a !== void 0 ? _a : `UNKNOWN (${tmd.hr[49]})`; },
            value: "",
        };
        this["state.alarm"] = {
            descr: "Active controller alarms as a JSON array",
            role: "state",
            unit: "",
            type: "array",
            readRegister: (tmd) => JSON.stringify((0, tristarMpptUtil_1.resolveAlarmBitfield)((0, tristarMpptUtil_1.to32bitNumber)(tmd.hr[46], tmd.hr[47]))),
            value: "[]",
        };
        this["state.equalizeTriggered"] = {
            descr: "Equalize triggered coil status",
            role: "state",
            unit: "",
            type: "boolean",
            source: "coil",
            initialized: false,
            readCoil: coils => coils[0] === true || coils[0] === 1,
            value: null,
        };
        this["state.chargeDisconnect"] = {
            descr: "Charge disconnect coil status",
            role: "state",
            unit: "",
            type: "boolean",
            source: "coil",
            initialized: false,
            readCoil: coils => coils[2] === true || coils[2] === 1,
            value: null,
        };
        this["today.batt.Vmin"] = {
            descr: "battery minimal voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[64]) * tmd.scale.v, 2),
            value: 0,
        };
        this["today.batt.Vmax"] = {
            descr: "battery maximal voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[65]) * tmd.scale.v, 2),
            value: 0,
        };
        this["today.solar.Vmax"] = {
            descr: "Maximum daily array voltage",
            role: "value.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[66]) * tmd.scale.v, 2),
            value: 0,
        };
        this["today.Ahc"] = {
            descr: "Amper hours",
            role: "state",
            unit: "Ah",
            type: "number",
            readRegister: (tmd) => tmd.hr[67] * 0.1,
            value: 0,
        };
        this["today.Whc"] = {
            descr: "watt hours",
            role: "state",
            unit: "Wh",
            type: "number",
            readRegister: (tmd) => tmd.hr[68],
            value: 0,
        };
        this["today.flags"] = {
            descr: "flags",
            role: "state",
            unit: "",
            type: "number",
            readRegister: (tmd) => tmd.hr[69],
            value: 0,
        };
        this["today.batt.Pmax"] = {
            descr: "maximal power output",
            role: "value",
            unit: "W",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)(tmd.hr[70] * tmd.scale.p, 0),
            value: 0,
        };
        this["today.batt.Tmin"] = {
            descr: "minimal battery temperature",
            role: "value.temperature",
            unit: "°C",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.signedToInteger)(tmd.hr[71]),
            value: 0,
        };
        this["today.batt.Tmax"] = {
            descr: "maximal battery temperature",
            role: "value.temperature",
            unit: "°C",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.signedToInteger)(tmd.hr[72]),
            value: 0,
        };
        this["today.fault"] = {
            descr: "Daily controller fault bitfield",
            role: "state",
            unit: "",
            type: "number",
            readRegister: (tmd) => tmd.hr[73],
            value: 0,
        };
        this["today.alarm"] = {
            descr: "Daily controller alarms as a JSON array",
            role: "state",
            unit: "",
            type: "array",
            readRegister: (tmd) => JSON.stringify((0, tristarMpptUtil_1.resolveAlarmBitfield)((0, tristarMpptUtil_1.to32bitNumber)(tmd.hr[75], tmd.hr[76]))),
            value: "[]",
        };
        this["today.timeAbsorption"] = {
            descr: "Cumulative time in absorption today",
            role: "state",
            unit: "s",
            type: "number",
            readRegister: (tmd) => tmd.hr[77],
            value: 0,
        };
        this["today.timeEqualize"] = {
            descr: "Cumulative time in equalization today",
            role: "state",
            unit: "s",
            type: "number",
            readRegister: (tmd) => tmd.hr[78],
            value: 0,
        };
        this["today.timeFloat"] = {
            descr: "Cumulative time in float today",
            role: "state",
            unit: "s",
            type: "number",
            readRegister: (tmd) => tmd.hr[79],
            value: 0,
        };
        this["control.IbattRefSlave"] = {
            descr: "Battery current regulation override. Refresh at least every 60 seconds; a negative value disables slave control.",
            role: "level.current",
            unit: "A",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[88]) * 80 * Math.pow(2, -15), 2),
            writeRegister: (twd) => ({ register: 88, value: (0, tristarMpptUtil_1.encodeSignedRegister)(twd.value, 80 * Math.pow(2, -15)) }),
            value: 0,
        };
        this["control.VbattRefSlave"] = {
            descr: "Battery voltage regulation override. Refresh at least every 60 seconds; a negative value disables slave control.",
            role: "level.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[89]) * tmd.scale.v, 2),
            writeRegister: (twd) => ({ register: 89, value: (0, tristarMpptUtil_1.encodeSignedRegister)(twd.value, twd.scale.v) }),
            value: 0,
        };
        this["control.VarrayFixed"] = {
            descr: "Fixed array voltage target. A non-zero value disables MPPT tracking.",
            role: "level.voltage",
            unit: "V",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(tmd.hr[90]) * tmd.scale.v, 2),
            writeRegister: (twd) => {
                if (twd.value < 0) {
                    throw new Error("Array voltage target must not be negative");
                }
                return { register: 90, value: (0, tristarMpptUtil_1.encodeSignedRegister)(twd.value, twd.scale.v) };
            },
            value: 0,
        };
        this["control.VarrayFixedPct"] = {
            descr: "Array voltage target as percent of Voc. A non-zero value disables MPPT tracking unless VarrayFixed is set.",
            role: "level",
            unit: "%",
            type: "number",
            readRegister: (tmd) => (0, tristarMpptUtil_1.round)(tmd.hr[91] * 100 * Math.pow(2, -16), 2),
            writeRegister: (twd) => {
                const value = twd.value;
                if (value < 0 || value > 100) {
                    throw new Error("Array voltage percentage must be between 0 and 100");
                }
                return { register: 91, value: value === 100 ? 0xffff : (0, tristarMpptUtil_1.encodeUnsignedRegister)(value, 100 * Math.pow(2, -16)) };
            },
            value: 0,
        };
        this["control.ClearFaults"] = {
            descr: "Clear controller faults",
            role: "button",
            unit: "",
            type: "boolean",
            writeCoil: () => ({ register: 20, value: 1 }),
            value: false,
            valueOld: false
        };
        this["control.ClearAlarm"] = {
            descr: "Clear controller alarms",
            role: "button",
            unit: "",
            type: "boolean",
            writeCoil: () => ({ register: 21, value: 1 }),
            value: false,
            valueOld: false
        };
        this["control.Reset"] = {
            descr: "Reset the controller after the Modbus response",
            role: "button",
            unit: "",
            type: "boolean",
            writeCoil: () => ({ register: 255, value: 1 }),
            value: false,
            valueOld: false
        };
    }
}
exports.TristarModel = TristarModel;
//# sourceMappingURL=tristarMpptModel.js.map