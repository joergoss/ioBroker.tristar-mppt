"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ledState = exports.charge_states = exports.alarmTextArray = void 0;
exports.signedToInteger = signedToInteger;
exports.round = round;
exports.to32bitNumber = to32bitNumber;
exports.encodeSignedRegister = encodeSignedRegister;
exports.encodeUnsignedRegister = encodeUnsignedRegister;
exports.resolveFaultsBitfield = resolveFaultsBitfield;
exports.resolveAlarmBitfield = resolveAlarmBitfield;
exports.byteString = byteString;
exports.wordString = wordString;
exports.splitIdFromAdapter = splitIdFromAdapter;
exports.errorText = errorText;
const node_util_1 = require("node:util");
// helper function to convert signed value to integer
function signedToInteger(value) {
    if ((value & 0x8000) > 0) {
        value = value - 0x10000;
    }
    return value;
}
function round(value, decimals) {
    const d = Math.pow(10, decimals);
    if (!isNaN(value)) {
        return Math.round(value * d) / d;
    }
    return 0;
}
function to32bitNumber(hi, lo) {
    return hi * 0x10000 + lo;
}
/**
 * Converts a physical value to a signed 16-bit Modbus register and returns its
 * unsigned wire representation.
 */
function encodeSignedRegister(value, scale) {
    if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) {
        throw new Error("Value and scale must be finite numbers; scale must be positive");
    }
    const rawValue = Math.round(value / scale);
    if (rawValue < -0x8000 || rawValue > 0x7fff) {
        throw new Error(`Value ${value} is outside the signed 16-bit register range`);
    }
    return rawValue & 0xffff;
}
function encodeUnsignedRegister(value, scale) {
    if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) {
        throw new Error("Value and scale must be finite numbers; scale must be positive");
    }
    const rawValue = Math.round(value / scale);
    if (rawValue < 0 || rawValue > 0xffff) {
        throw new Error(`Value ${value} is outside the unsigned 16-bit register range`);
    }
    return rawValue;
}
const faultsTextArray = [
    "overcurrent",
    "FETs shorted",
    "software bug",
    "battery HVD",
    "array HVD",
    "settings switch changed",
    "custom settings edit",
    "RTS shorted",
    "RTS disconnected",
    "EEPROM retry limit",
    "Reserved",
    "Slave Control Timeout",
    "Fault 13",
    "Fault 14",
    "Fault 15",
    "Fault 16",
];
function resolveFaultsBitfield(value) {
    const r = [];
    for (let i = 0; i < 16; i++) {
        if ((value & 0b00000001) === 1)
            r.push(faultsTextArray[i]);
        value = value >> 1;
    }
    return r;
}
exports.alarmTextArray = [
    "RTS open",
    "RTS shorted",
    "RTS disconnected",
    "Heatsink temp sensor open",
    "Heatsink temp sensor shorted",
    "High temperature current limit",
    "Current limit",
    "Current offset",
    "Battery sense out of range",
    "Battery sense disconnected",
    "Uncalibrated",
    "RTS miswire",
    "High voltage disconnect",
    "Undefined",
    "system miswire",
    "MOSFET open",
    "P12 voltage off",
    "High input voltage current limit",
    "ADC input max",
    "Controller was reset",
    "Alarm 21",
    "Alarm 22",
    "Alarm 23",
    "Alarm 24",
];
function resolveAlarmBitfield(value) {
    const r = [];
    for (let i = 0; i < 24; i++) {
        if ((value & 0b00000001) === 1)
            r.push(exports.alarmTextArray[i]);
        value = value >> 1;
    }
    return r;
}
exports.charge_states = {
    0: "START",
    1: "NIGHT_CHECK",
    2: "DISCONNECT",
    3: "NIGHT",
    4: "FAULT",
    5: "MPPT",
    6: "ABSORPTION",
    7: "FLOAT",
    8: "EQUALIZE",
    9: "SLAVE",
};
exports.ledState = {
    0: "LED_START",
    1: "LED_START2",
    2: "LED_BRANCH",
    3: "FAST GREEN BLINK",
    4: "SLOW GREEN BLINK",
    5: "GREEN BLINK, 1HZ",
    6: "GREEN_LED",
    7: "UNDEFINED",
    8: "YELLOW_LED",
    9: "UNDEFINED",
    10: "BLINK_RED_LED",
    11: "RED_LED",
    12: "R-Y-G ERROR",
    13: "R/Y-G ERROR",
    14: "R/G-Y ERROR",
    15: "R-Y ERROR (HTD)",
    16: "R-G ERROR (HVD)",
    17: "R/Y-G/Y ERROR",
    18: "G/Y/R ERROR",
    19: "G/Y/R x 2",
};
function byteString(n) {
    if (n < 0 || n > 255 || n % 1 !== 0) {
        throw new Error(n + " does not fit in a byte");
    }
    return ("000000000" + n.toString(2)).substr(-8);
}
function wordString(n) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
        throw new Error(`${n} does not fit in a 16-bit word`);
    }
    return n.toString(2).padStart(16, "0");
}
function splitIdFromAdapter(str) {
    const delimiter = ".";
    const start = 2;
    const tokens = str.split(delimiter).slice(start);
    return tokens.join(delimiter);
}
function errorText(error) {
    if (error instanceof Error) {
        return error.stack || error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    // jsmodbus may reject with plain objects from another realm. String(error)
    // would only say "[object Object]"; inspect also shows non-enumerable details.
    return (0, node_util_1.inspect)(error, { depth: 4, breakLength: 160 });
}
//# sourceMappingURL=tristarMpptUtil.js.map