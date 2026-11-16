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

describe("local Modbus TCP integration", () => {
	it("reads 92 registers through the public response API and writes registers/coils", async () => {
		const holding = Buffer.alloc(92 * 2);
		holding.writeUInt16BE(80, 0);
		holding.writeUInt16BE(80, 4);
		holding.writeUInt16BE(4096, 24 * 2);
		const coils = Buffer.alloc(32);
		const server = net.createServer();
		new modbus.server.TCP(server, { holding, coils });
		const port = await listen(server);
		const client = new TristarMpptTCPModbus();

		try {
			await client.readHoldingRegister(configForPort(port));
			expect(client.lastHoldingRegisters).to.have.length(92);
			expect(client.tristarData["batt.V"].value).to.equal(10);

			await client.writeHoldingRegister(configForPort(port), { register: 89, value: 4096 });
			expect(holding.readUInt16BE(89 * 2)).to.equal(4096);

			await client.writeCoil(configForPort(port), { register: 20, value: 1 });
			expect(coils.readUInt8(2) & 0b00010000).to.equal(0b00010000);
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
