"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TristarStaticModel = void 0;
const tristarMpptUtil_1 = require("./tristarMpptUtil");
const raw = (address) => data => data.readStatic(address);
const signed = (address) => data => (0, tristarMpptUtil_1.signedToInteger)(data.readStatic(address));
const voltage = (address) => data => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(data.readStatic(address)) * data.scale.v, 2);
const current = (address) => data => (0, tristarMpptUtil_1.round)((0, tristarMpptUtil_1.signedToInteger)(data.readStatic(address)) * data.scale.i, 2);
const temperatureCompensation = (address) => data => (0, tristarMpptUtil_1.round)(data.readStatic(address) * data.scale.v / 2, 5);
const percentage = (address) => data => (0, tristarMpptUtil_1.round)(data.readStatic(address) * 100 * Math.pow(2, -16), 2);
const unsigned32 = (loAddress, factor = 1) => data => (0, tristarMpptUtil_1.to32bitNumber)(data.readStatic(loAddress + 1), data.readStatic(loAddress)) * factor;
const nonNegativeSigned = (value, scale) => {
    if (value < 0) {
        throw new Error("EEPROM value must not be negative");
    }
    return (0, tristarMpptUtil_1.encodeSignedRegister)(value, scale.v);
};
const unsigned = value => {
    if (!Number.isInteger(value)) {
        throw new Error("Timer values must be integers");
    }
    return (0, tristarMpptUtil_1.encodeUnsignedRegister)(value, 1);
};
const unsignedVoltage = (value, scale) => (0, tristarMpptUtil_1.encodeUnsignedRegister)(value, scale.v / 2);
const byteValue = value => {
    if (!Number.isInteger(value)) {
        throw new Error("Calendar value must be an integer");
    }
    if (value > 255) {
        throw new Error("Value must be between 0 and 255");
    }
    return (0, tristarMpptUtil_1.encodeUnsignedRegister)(value, 1);
};
function packedBytes(data, address, count) {
    const bytes = [];
    for (let index = 0; index < count; index += 2) {
        const word = data.readStatic(address + index / 2);
        bytes.push(word & 0xff, word >>> 8);
    }
    return bytes;
}
function packedString(data, address, count) {
    const bytes = packedBytes(data, address, count);
    const end = bytes.indexOf(0);
    return String.fromCharCode(...bytes.slice(0, end === -1 ? bytes.length : end));
}
function serialNumber(data) {
    // The example serial 01234567 is stored as 0x3130, 0x3332, ...
    // so the low byte contains the first character.
    return packedString(data, 0xe0c0, 8);
}
function ipv4(data, address) {
    return packedBytes(data, address, 4).join(".");
}
function macAddress(data) {
    return packedBytes(data, 0x1026, 6).map(value => value.toString(16).padStart(2, "0")).join(":");
}
class TristarStaticModel {
    constructor() {
        const definitions = [
            // Active TCP network settings (all read-only).
            { id: "network.processorBVersion", descr: "Network processor firmware raw version", address: 0x1000, source: "network", type: "string", decode: data => `0x${data.readStatic(0x1000).toString(16).padStart(4, "0")}` },
            { id: "network.ip", descr: "Active IP address", address: 0x100f, source: "network", type: "string", decode: data => ipv4(data, 0x100f) },
            { id: "network.subnetMask", descr: "Active subnet mask", address: 0x1011, source: "network", type: "string", decode: data => ipv4(data, 0x1011) },
            { id: "network.gateway", descr: "Active gateway", address: 0x1013, source: "network", type: "string", decode: data => ipv4(data, 0x1013) },
            { id: "network.primaryDns", descr: "Active primary DNS", address: 0x1015, source: "network", type: "string", decode: data => ipv4(data, 0x1015) },
            { id: "network.secondaryDns", descr: "Active secondary DNS", address: 0x1017, source: "network", type: "string", decode: data => ipv4(data, 0x1017) },
            { id: "network.controllerId", descr: "Controller ID", address: 0x101d, source: "network", type: "string", decode: data => packedString(data, 0x101d, 16) },
            { id: "network.flags", descr: "Active network flags", address: 0x1025, source: "network", decode: raw(0x1025) },
            { id: "network.dhcpEnabled", descr: "DHCP enabled", address: 0x1025, source: "network", type: "boolean", decode: data => (data.readStatic(0x1025) & 0x4000) !== 0 },
            { id: "network.mac", descr: "Controller MAC address", address: 0x1026, source: "network", type: "string", decode: macAddress },
            { id: "network.netbiosName", descr: "NetBIOS name", address: 0x1029, source: "network", type: "string", decode: data => packedString(data, 0x1029, 16) },
            // EEPROM network settings are deliberately read-only to prevent lockout.
            { id: "eeprom.network.httpPort", descr: "Configured HTTP port", address: 0x151b, source: "eeprom", decode: raw(0x151b) },
            { id: "eeprom.network.modbusPort", descr: "Configured Modbus TCP port", address: 0x151c, source: "eeprom", decode: raw(0x151c) },
            { id: "eeprom.network.ipBridging", descr: "Modbus TCP to EIA-485 bridging", address: 0x151d, source: "eeprom", type: "boolean", decode: data => (data.readStatic(0x151d) & 1) !== 0 },
            { id: "eeprom.network.snmpTrapPort", descr: "SNMP trap destination port", address: 0x151e, source: "eeprom", decode: raw(0x151e) },
            { id: "eeprom.network.ethernetPowerSave", descr: "Ethernet power saving", address: 0x151f, source: "eeprom", type: "boolean", decode: data => (data.readStatic(0x151f) & 1) !== 0 },
            { id: "eeprom.network.vlanEnabled", descr: "VLAN enabled (firmware 8.21 beta)", address: 0x1520, source: "eeprom", type: "boolean", decode: data => (data.readStatic(0x1520) & 1) !== 0 },
            { id: "eeprom.network.vlanParameters", descr: "VLAN parameters raw bitfield", address: 0x1521, source: "eeprom", decode: raw(0x1521) },
            // EEPROM charge settings. Only explicitly allowlisted entries have an encoder.
            { id: "eeprom.charge.absorptionV", descr: "Absorption voltage at 25 °C", address: 0xe000, source: "eeprom", unit: "V", role: "level.voltage", decode: voltage(0xe000), encode: nonNegativeSigned },
            { id: "eeprom.charge.floatV", descr: "Float voltage at 25 °C; 0 disables float", address: 0xe001, source: "eeprom", unit: "V", role: "level.voltage", decode: voltage(0xe001), encode: nonNegativeSigned },
            { id: "eeprom.charge.absorptionTime", descr: "Absorption time", address: 0xe002, source: "eeprom", unit: "s", role: "level", decode: raw(0xe002), encode: unsigned },
            { id: "eeprom.charge.absorptionExtensionTime", descr: "Absorption extension time", address: 0xe003, source: "eeprom", unit: "s", role: "level", decode: raw(0xe003), encode: unsigned },
            { id: "eeprom.charge.absorptionExtensionV", descr: "Absorption extension threshold", address: 0xe004, source: "eeprom", unit: "V", role: "level.voltage", decode: voltage(0xe004), encode: nonNegativeSigned },
            { id: "eeprom.charge.floatCancelV", descr: "Voltage that cancels float", address: 0xe005, source: "eeprom", unit: "V", role: "level.voltage", decode: voltage(0xe005), encode: nonNegativeSigned },
            { id: "eeprom.charge.floatExitTime", descr: "Cumulative exit-float timer", address: 0xe006, source: "eeprom", unit: "s", role: "level", decode: raw(0xe006), encode: unsigned },
            { id: "eeprom.charge.equalizeV", descr: "Equalize voltage at 25 °C; 0 disables equalize", address: 0xe007, source: "eeprom", unit: "V", role: "level.voltage", decode: voltage(0xe007), encode: nonNegativeSigned },
            { id: "eeprom.charge.equalizeCalendarDays", descr: "Days between equalize cycles", address: 0xe008, source: "eeprom", unit: "d", role: "level", decode: raw(0xe008), encode: byteValue },
            { id: "eeprom.charge.equalizeAboveTime", descr: "Equalize time limit above regulation voltage", address: 0xe009, source: "eeprom", unit: "s", role: "level", decode: raw(0xe009), encode: unsigned },
            { id: "eeprom.charge.equalizeRegulationTime", descr: "Equalize time limit at equalize voltage", address: 0xe00a, source: "eeprom", unit: "s", role: "level", decode: raw(0xe00a), encode: unsigned },
            { id: "eeprom.charge.batteryServiceDays", descr: "Battery service reminder interval", address: 0xe00b, source: "eeprom", unit: "d", role: "level", decode: raw(0xe00b), encode: unsigned },
            { id: "eeprom.charge.temperatureCompensation", descr: "Positive temp-comp magnitude; controller applies a negative coefficient", address: 0xe00d, source: "eeprom", unit: "V/°C", role: "level", decode: temperatureCompensation(0xe00d), encode: unsignedVoltage },
            { id: "eeprom.charge.hvdV", descr: "Battery high-voltage disconnect; read-only for safety", address: 0xe00e, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe00e) },
            { id: "eeprom.charge.hvrV", descr: "Battery high-voltage reconnect; read-only for safety", address: 0xe00f, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe00f) },
            { id: "eeprom.charge.regulationLimitV", descr: "Absolute battery regulation limit; read-only for safety", address: 0xe010, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe010) },
            { id: "eeprom.charge.temperatureMax", descr: "Maximum temperature compensation limit", address: 0xe011, source: "eeprom", unit: "°C", role: "value.temperature", decode: signed(0xe011) },
            { id: "eeprom.charge.temperatureMin", descr: "Minimum temperature compensation limit", address: 0xe012, source: "eeprom", unit: "°C", role: "value.temperature", decode: signed(0xe012) },
            { id: "eeprom.charge.ledGreenToGreenYellowV", descr: "LED threshold green to green/yellow", address: 0xe015, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe015) },
            { id: "eeprom.charge.ledGreenYellowToYellowV", descr: "LED threshold green/yellow to yellow", address: 0xe016, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe016) },
            { id: "eeprom.charge.ledYellowToYellowRedV", descr: "LED threshold yellow to yellow/red", address: 0xe017, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe017) },
            { id: "eeprom.charge.ledYellowRedToRedV", descr: "LED threshold yellow/red to red", address: 0xe018, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe018) },
            { id: "eeprom.charge.modbusId", descr: "Configured Modbus ID; read-only to prevent lockout", address: 0xe019, source: "eeprom", decode: raw(0xe019) },
            { id: "eeprom.charge.meterbusId", descr: "Configured MeterBus ID; read-only", address: 0xe01a, source: "eeprom", decode: raw(0xe01a) },
            { id: "eeprom.charge.currentLimitA", descr: "Persistent battery current limit; read-only for safety", address: 0xe01d, source: "eeprom", unit: "A", role: "value.current", decode: current(0xe01d) },
            { id: "eeprom.charge.arrayFixedV", descr: "Persistent fixed array voltage; read-only for safety", address: 0xe020, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe020) },
            { id: "eeprom.charge.arrayFixedPct", descr: "Persistent array target percent of Voc; read-only for safety", address: 0xe021, source: "eeprom", unit: "%", role: "value", decode: percentage(0xe021) },
            // Explicit EEPROM read-only history and identity. These use LO word first.
            { id: "eeprom.history.hourmeter", descr: "Persisted hourmeter snapshot", address: 0xe080, source: "eeprom", unit: "h", decode: unsigned32(0xe080) },
            { id: "eeprom.history.ahResettable", descr: "Persisted resettable amp-hours", address: 0xe082, source: "eeprom", unit: "Ah", decode: unsigned32(0xe082, 0.1) },
            { id: "eeprom.history.ahTotal", descr: "Persisted total amp-hours", address: 0xe084, source: "eeprom", unit: "Ah", decode: unsigned32(0xe084, 0.1) },
            { id: "eeprom.history.kwhResettable", descr: "Persisted resettable kilowatt-hours", address: 0xe086, source: "eeprom", unit: "kWh", decode: raw(0xe086) },
            { id: "eeprom.history.kwhTotal", descr: "Persisted total kilowatt-hours", address: 0xe087, source: "eeprom", unit: "kWh", decode: raw(0xe087) },
            { id: "eeprom.history.batteryVmin", descr: "Persisted minimum battery voltage", address: 0xe088, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe088) },
            { id: "eeprom.history.batteryVmax", descr: "Persisted maximum battery voltage", address: 0xe089, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe089) },
            { id: "eeprom.history.arrayVmax", descr: "Persisted maximum array voltage", address: 0xe08a, source: "eeprom", unit: "V", role: "value.voltage", decode: voltage(0xe08a) },
            { id: "eeprom.history.daysSinceEqualize", descr: "Days since last equalization", address: 0xe08b, source: "eeprom", unit: "d", decode: raw(0xe08b) },
            { id: "eeprom.history.daysSinceBatteryService", descr: "Days since battery service reminder", address: 0xe08c, source: "eeprom", unit: "d", decode: raw(0xe08c) },
            { id: "eeprom.info.serial", descr: "Controller serial number", address: 0xe0c0, source: "eeprom", type: "string", decode: serialNumber },
            { id: "eeprom.info.model", descr: "Controller model", address: 0xe0cc, source: "eeprom", type: "string", decode: data => { var _a; return ((_a = { 0: "TS-MPPT-45", 1: "TS-MPPT-60" }[data.readStatic(0xe0cc)]) !== null && _a !== void 0 ? _a : `UNKNOWN (${data.readStatic(0xe0cc)})`); } },
            { id: "eeprom.info.hardwareVersion", descr: "Controller hardware version", address: 0xe0cd, source: "eeprom", type: "string", decode: data => `${data.readStatic(0xe0cd) >>> 8}.${data.readStatic(0xe0cd) & 0xff}` },
        ];
        for (const definition of definitions) {
            addStaticEntry(this, definition);
        }
    }
}
exports.TristarStaticModel = TristarStaticModel;
function addStaticEntry(model, definition) {
    var _a, _b, _c;
    model[definition.id] = {
        descr: definition.descr,
        unit: (_a = definition.unit) !== null && _a !== void 0 ? _a : "",
        role: ((_b = definition.role) !== null && _b !== void 0 ? _b : "state"),
        type: (_c = definition.type) !== null && _c !== void 0 ? _c : "number",
        source: definition.source,
        registerAddress: definition.address,
        initialized: false,
        readRegister: definition.decode,
        writeRegister: definition.encode
            ? twd => ({ register: definition.address, value: definition.encode(twd.value, twd.scale) })
            : undefined,
        value: null,
    };
}
//# sourceMappingURL=tristarMpptStaticModel.js.map