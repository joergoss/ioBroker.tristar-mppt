import { expect } from "chai";
import * as modbus from "jsmodbus";
import * as net from "net";
import { TristarMpptTCPModbus } from "./tristarMpptTCPModbus";

function configForPort(port: number): ioBroker.AdapterConfig {
	return { hostname: "127.0.0.1", port, unitId: 1, interval: 1, installedWP: 0 } as ioBroker.AdapterConfig;
}

async function listen(server: net.Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return (server.address() as net.AddressInfo).port;
}

async function closeServer(server: net.Server): Promise<void> {
	(server as any).closeAllConnections?.();
	await new Promise<void>(resolve => server.close(() => resolve()));
}

describe("Modbus operation pipeline", () => {
	it("runs operations sequentially in FIFO order", async () => {
		const client = new TristarMpptTCPModbus() as any;
		const events: string[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>(resolve => releaseFirst = resolve);

		const first = client.enqueue(async () => {
			events.push("start first");
			await firstGate;
			events.push("end first");
		});
		const second = client.enqueue(async () => {
			events.push("start second");
		});
		await Promise.resolve();

		expect(events).to.deep.equal(["start first"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(events).to.deep.equal(["start first", "end first", "start second"]);
	});

	it("continues with the next operation after a failed operation", async () => {
		const client = new TristarMpptTCPModbus() as any;
		let secondRan = false;

		const first = client.enqueue(async () => {
			throw new Error("expected failure");
		});
		const second = client.enqueue(async () => {
			secondRan = true;
		});

		try {
			await first;
			expect.fail("first operation should reject");
		} catch (error) {
			expect((error as Error).message).to.equal("expected failure");
		}
		await second;
		expect(secondRan).to.equal(true);
	});

	it("rejects new operations after shutdown without opening a socket", async () => {
		const client = new TristarMpptTCPModbus() as any;
		client.close();

		try {
			await client.enqueue(async () => undefined);
			expect.fail("operation should reject");
		} catch (error) {
			expect((error as Error).message).to.equal("Modbus client is stopping");
		}
	});
});

describe("solar outlier filtering", () => {
	it("keeps raw values canonical and filters a reconstructed historical single-poll anomaly", async () => {
		const client = new TristarMpptTCPModbus();
		const config = { installedWP: 1779 } as ioBroker.AdapterConfig;
		const regular = new Array<number>(92).fill(0);
		regular[0] = 180;
		regular[2] = 80;
		const anomaly = [...regular];
		anomaly[28] = 242;
		anomaly[29] = 26362;
		anomaly[58] = 66;
		anomaly[59] = 25213;

		await client.updateTristarData(regular, config);
		expect(client.tristarData["solar.InPowerFiltered"].value).to.equal(null);
		await client.updateTristarData(anomaly, config);
		expect(client.tristarData["solar.I"].value).to.equal(64.36);
		expect(client.tristarData["solar.InPower"].value).to.equal(2770);
		expect(client.tristarData["batt.OutPower"].value).to.equal(7.25);
		expect(client.tristarData["solar.InPowerFiltered"].value).to.equal(null);
		await client.updateTristarData(regular, config);
		expect(client.tristarData["solar.InPower"].value).to.equal(0);
		expect(client.tristarData["solar.IFiltered"].value).to.equal(0);
		expect(client.tristarData["solar.InPowerFiltered"].value).to.equal(0);
		expect(client.tristarData["solar.InPowerPercentFiltered"].value).to.equal(0);
	});
});

describe("full-frame decoder robustness", () => {
	it("keeps all RAM values available when upper DIP bits are set", async () => {
		const client = new TristarMpptTCPModbus();
		const registers = new Array<number>(92).fill(0);
		registers[0] = 80;
		registers[2] = 80;
		registers[24] = 4096;
		registers[48] = 0x8000;

		await client.updateTristarData(registers, { installedWP: 0 } as ioBroker.AdapterConfig);

		expect(client.tristarData["state.dip"].value).to.equal("1000000000000000");
		expect(client.tristarData["batt.V"].value).to.equal(10);
	});
});

describe("partial static register support", () => {
	it("publishes available values without marking missing blocks as initialized", () => {
		const client = new TristarMpptTCPModbus();
		const registers = new Array<number>(92).fill(0);
		registers[0] = 80;
		registers[2] = 80;
		client.lastHoldingRegisters = registers;
		const staticRegisters = new Map<number, number>([[0xe000, 4096]]);

		const errors = client.updateStaticData(staticRegisters, { installedWP: 0 } as ioBroker.AdapterConfig);

		expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(10);
		expect(client.tristarData["eeprom.charge.absorptionV"].initialized).to.equal(true);
		expect(client.tristarData["eeprom.charge.hvdV"].initialized).to.equal(false);
		expect(errors.length).to.be.greaterThan(0);
	});
});

describe("local Modbus TCP integration", () => {
	it("reads 92 registers through the public response API and writes registers/coils", async () => {
		const holding = Buffer.alloc(92 * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		holding.writeUInt16BE(4096, 24 * 2);
		const coils = Buffer.alloc(32);
		coils[0] = 0b00000101;
		const server = net.createServer();
		new modbus.server.TCP(server, { holding, coils });
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();

		try {
			await client.readHoldingRegister(configForPort(port));
			expect(client.lastHoldingRegisters).to.have.length(92);
			expect(client.tristarData["batt.V"].value).to.equal(10);

			await client.readCoilStates(configForPort(port));
			expect(client.tristarData["state.equalizeTriggered"].value).to.equal(true);
			expect(client.tristarData["state.chargeDisconnect"].value).to.equal(true);

			await client.writeHoldingRegister(configForPort(port), { register: 89, value: 4096 });
			expect(holding.readUInt16BE(89 * 2)).to.equal(4096);

			await client.writeCoil(configForPort(port), { register: 20, value: 1 });
			expect(coils.readUInt8(2) & 0b00010000).to.equal(0b00010000);
		} finally {
			client.close();
			await closeServer(server);
		}
	});

	it("rejects a premature peer close and releases the operation queue", async () => {
		const server = net.createServer(socket => {
			socket.once("data", () => socket.end());
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();

		try {
			await client.readHoldingRegister(configForPort(port));
			expect.fail("read should reject when no Modbus response arrives");
		} catch (error) {
			expect((error as Error).message).to.contain("peer closed");
		}
		let nextOperationRan = false;
		await (client as any).enqueue(async () => {
			nextOperationRan = true;
		});
		expect(nextOperationRan).to.equal(true);
		await closeServer(server);
	});

	it("accepts valid Modbus responses followed immediately by FIN", async () => {
		const holding = Buffer.alloc(92 * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		holding.writeUInt16BE(4096, 24 * 2);
		const server = net.createServer();
		let peer: net.Socket | undefined;
		server.on("connection", socket => peer = socket);
		const modbusServer = new modbus.server.TCP(server, { holding });
		modbusServer.on("postReadHoldingRegisters", () => peer?.end());
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();

		try {
			for (let index = 0; index < 10; index++) {
				await client.readHoldingRegister(configForPort(port));
			}
			expect(client.tristarData["batt.V"].value).to.equal(10);
		} finally {
			client.close();
			await closeServer(server);
		}
	});

	it("handles EEPROM write and readback when every response is followed by FIN", async () => {
		const holding = Buffer.alloc(0xe0ce * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		holding.writeUInt16BE(4096, 0xe000 * 2);
		const input = Buffer.alloc(0xe0ce * 2);
		input.writeUInt16BE(4096, 0xe000 * 2);
		const coils = Buffer.alloc(32);
		const server = net.createServer();
		let peer: net.Socket | undefined;
		server.on("connection", socket => peer = socket);
		const modbusServer = new modbus.server.TCP(server, { holding, input, coils });
		let writes = 0;
		modbusServer.on("postReadHoldingRegisters", () => peer?.end());
		modbusServer.on("postReadInputRegisters", () => peer?.end());
		modbusServer.on("postWriteSingleRegister", () => {
			writes++;
			input.writeUInt16BE(holding.readUInt16BE(0xe000 * 2), 0xe000 * 2);
			peer?.end();
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();
		const config = configForPort(port);

		try {
			await client.readHoldingRegister(config);
			client.lastStaticRegisters = new Map([[0xe000, 4096]]);
			await client.writeEepromRegister(config, { register: 0xe000, value: 8192 }, 4096);
			expect(holding.readUInt16BE(0xe000 * 2)).to.equal(8192);
			expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(20);
			expect(writes).to.equal(1);
			expect(coils.equals(Buffer.alloc(32))).to.equal(true);
		} finally {
			client.close();
			await closeServer(server);
		}
	});

	it("rejects a readback mismatch without retry or updating the state", async () => {
		const holding = Buffer.alloc(0xe0ce * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		const input = Buffer.alloc(0xe0ce * 2);
		input.writeUInt16BE(4096, 0xe000 * 2);
		const coils = Buffer.alloc(32);
		const server = net.createServer();
		const modbusServer = new modbus.server.TCP(server, { holding, input, coils });
		let writes = 0;
		modbusServer.on("postWriteSingleRegister", () => {
			writes++;
			input.writeUInt16BE(8193, 0xe000 * 2);
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();
		const config = configForPort(port);

		try {
			await client.readHoldingRegister(config);
			client.updateStaticData(new Map([[0xe000, 4096]]), config);
			await client.writeEepromRegister(config, { register: 0xe000, value: 8192 }, 4096);
			expect.fail("readback mismatch should reject");
		} catch (error) {
			expect((error as Error).message).to.contain("readback mismatch");
		} finally {
			expect(writes).to.equal(1);
			expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(10);
			expect(coils.equals(Buffer.alloc(32))).to.equal(true);
			client.close();
			await closeServer(server);
		}
	});

	it("rejects a failed readback without retry or updating the state", async () => {
		const holding = Buffer.alloc(0xe0ce * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		const input = Buffer.alloc(0xe0ce * 2);
		input.writeUInt16BE(4096, 0xe000 * 2);
		const coils = Buffer.alloc(32);
		const server = net.createServer();
		const modbusServer = new modbus.server.TCP(server, { holding, input, coils });
		let writes = 0;
		modbusServer.on("postWriteSingleRegister", () => {
			writes++;
			server.close();
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();
		const config = configForPort(port);

		try {
			await client.readHoldingRegister(config);
			client.updateStaticData(new Map([[0xe000, 4096]]), config);
			await client.writeEepromRegister(config, { register: 0xe000, value: 8192 }, 4096);
			expect.fail("failed readback should reject");
		} catch (error) {
			expect((error as Error).message).to.contain("do not retry blindly");
		} finally {
			expect(writes).to.equal(1);
			expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(10);
			expect(coils.equals(Buffer.alloc(32))).to.equal(true);
			client.close();
			await closeServer(server);
		}
	});

	it("keeps base network and charge values when optional VLAN registers are rejected", async () => {
		const registers = new Map<number, number>([[0xe000, 4096], [0x151b, 80], [0x151c, 502]]);
		const server = net.createServer(socket => {
			socket.once("data", request => {
				const transaction = request.subarray(0, 2);
				const unit = request[6];
				const functionCode = request[7];
				const address = request.readUInt16BE(8);
				const count = request.readUInt16BE(10);
				const expectedFunctionCode = address >= 0x151b ? 4 : 3;
				if (functionCode !== expectedFunctionCode) {
					socket.end(Buffer.concat([transaction, Buffer.from([0, 0, 0, 3, unit, functionCode | 0x80, 0x01])]));
					return;
				}
				if (address === 0x1520) {
					socket.end(Buffer.concat([transaction, Buffer.from([0, 0, 0, 3, unit, functionCode | 0x80, 0x02])]));
					return;
				}
				const values = Buffer.alloc(count * 2);
				for (let index = 0; index < count; index++) {
					values.writeUInt16BE(registers.get(address + index) ?? 0, index * 2);
				}
				const header = Buffer.concat([transaction, Buffer.from([0, 0])]);
				const responseHeader = Buffer.alloc(4);
				responseHeader.writeUInt16BE(values.length + 3, 0);
				responseHeader.writeUInt8(unit, 2);
				responseHeader.writeUInt8(functionCode, 3);
				socket.end(Buffer.concat([header, responseHeader, Buffer.from([values.length]), values]));
			});
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();
		const ram = new Array<number>(92).fill(0);
		ram[0] = 80;
		ram[2] = 80;
		client.lastHoldingRegisters = ram;

		try {
			await client.readStaticRegisters(configForPort(port));
			expect.fail("partial VLAN failure should be reported");
		} catch (error) {
			expect((error as Error).message).to.contain("Some static register blocks");
		} finally {
			expect(client.tristarData["eeprom.network.httpPort"].value).to.equal(80);
			expect(client.tristarData["eeprom.network.modbusPort"].value).to.equal(502);
			expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(10);
			expect(client.tristarData["eeprom.network.vlanEnabled"].initialized).to.equal(false);
			client.close();
			await closeServer(server);
		}
	});

	it("reads static EEPROM/network blocks and verifies guarded EEPROM writes locally", async () => {
		const holding = Buffer.alloc(0xe0ce * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		holding.writeUInt16BE(0xa8c0, 0x100f * 2);
		holding.writeUInt16BE(0xfd01, 0x1010 * 2);
		const input = Buffer.alloc(0xe0ce * 2);
		input.writeUInt16BE(4096, 0xe000 * 2);
		input.writeUInt16BE(1, 0xe0cc * 2);
		const coils = Buffer.alloc(32);
		const server = net.createServer();
		const modbusServer = new modbus.server.TCP(server, { holding, input, coils });
		let eepromWrites = 0;
		let holdingReads = 0;
		let inputReads = 0;
		modbusServer.on("postReadHoldingRegisters", () => holdingReads++);
		modbusServer.on("postReadInputRegisters", () => inputReads++);
		modbusServer.on("postWriteSingleRegister", () => {
			eepromWrites++;
			input.writeUInt16BE(holding.readUInt16BE(0xe000 * 2), 0xe000 * 2);
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();
		const config = configForPort(port);

		try {
			await client.readHoldingRegister(config);
			await client.readStaticRegisters(config);
			expect(client.staticDataLoaded).to.equal(true);
			expect(holdingReads).to.equal(5); // Initial RAM read plus four Active-TCP blocks.
			expect(inputReads).to.equal(10); // Every EEPROM block uses FC04.
			expect(client.tristarData["network.ip"].value).to.equal("192.168.1.253");
			expect(client.tristarData["eeprom.info.model"].value).to.equal("TS-MPPT-60");
			expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(10);

			await client.writeEepromRegister(config, { register: 0xe000, value: 8192 }, 4096);
			expect(holding.readUInt16BE(0xe000 * 2)).to.equal(8192);
			expect(client.tristarData["eeprom.charge.absorptionV"].value).to.equal(20);
			expect(eepromWrites).to.equal(1);
			expect(coils.equals(Buffer.alloc(32))).to.equal(true);

			try {
				await client.writeEepromRegister(config, { register: 0xe000, value: 4096 }, 1234);
				expect.fail("stale expected value should reject");
			} catch (error) {
				expect((error as Error).message).to.contain("changed");
			}
			expect(holding.readUInt16BE(0xe000 * 2)).to.equal(8192);
			expect(eepromWrites).to.equal(1);
		} finally {
			client.close();
			await closeServer(server);
		}
	});

	it("aborts an active request during shutdown", async () => {
		const server = net.createServer();
		const requestReceived = new Promise<void>(resolve => {
			server.on("connection", socket => socket.once("data", () => resolve()));
		});
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();
		const read = client.readHoldingRegister(configForPort(port));
		await requestReceived;

		client.close();

		try {
			await read;
			expect.fail("read should reject during shutdown");
		} catch (error) {
			expect((error as Error).message).to.equal("Adapter is stopping");
		} finally {
			await closeServer(server);
		}
	});
});
