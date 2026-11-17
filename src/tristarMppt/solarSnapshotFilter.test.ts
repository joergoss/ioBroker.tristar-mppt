import { expect } from "chai";
import { SolarSnapshotFilter } from "./solarSnapshotFilter";

function snapshot(current: number, power: number): { current: number; power: number } {
	return { current, power };
}

describe("SolarSnapshotFilter", () => {
	it("suppresses isolated spikes without clipping sustained values", () => {
		const filter = new SolarSnapshotFilter();

		expect(filter.add("scale", snapshot(0, 0))).to.equal(null);
		expect(filter.add("scale", snapshot(64.36, 2770))).to.equal(null);
		expect(filter.add("scale", snapshot(0, 0))).to.deep.equal(snapshot(0, 0));
		expect(filter.add("scale", snapshot(1, 100))).to.deep.equal(snapshot(1, 100));
		expect(filter.add("scale", snapshot(1, 100))).to.deep.equal(snapshot(1, 100));
		expect(filter.add("scale", snapshot(1, 100))).to.deep.equal(snapshot(1, 100));
	});

	it("does not hide two consecutive high samples", () => {
		const filter = new SolarSnapshotFilter();
		filter.add("scale", snapshot(0, 0));
		filter.add("scale", snapshot(0, 0));
		expect(filter.add("scale", snapshot(64, 2770))).to.deep.equal(snapshot(0, 0));
		expect(filter.add("scale", snapshot(64, 2770))).to.deep.equal(snapshot(64, 2770));
	});

	it("resets on scale changes, communication gaps and invalid values", () => {
		const filter = new SolarSnapshotFilter();
		filter.add("scale-a", snapshot(1, 100));
		filter.add("scale-a", snapshot(1, 100));
		expect(filter.add("scale-b", snapshot(1, 100))).to.equal(null);
		filter.add("scale-b", snapshot(1, 100));
		filter.reset();
		expect(filter.add("scale-b", snapshot(1, 100))).to.equal(null);
		expect(filter.add("scale-b", snapshot(Number.NaN, 100))).to.equal(null);
		expect(filter.add("scale-b", snapshot(1, 100))).to.equal(null);
	});
});
