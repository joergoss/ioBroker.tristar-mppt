import { expect } from "chai";
import { encodeSignedRegister, encodeUnsignedRegister, signedToInteger, to32bitNumber, wordString } from "./tristarMpptUtil";

describe("register conversion properties", () => {
	it("roundtrips every possible signed and unsigned 16-bit raw value", () => {
		const signedScale = 80 / 32768;
		const unsignedScale = 100 / 65536;
		for (let rawValue = 0; rawValue <= 0xffff; rawValue++) {
			const signedValue = signedToInteger(rawValue);
			expect(encodeSignedRegister(signedValue * signedScale, signedScale)).to.equal(rawValue);
			expect(encodeUnsignedRegister(rawValue * unsignedScale, unsignedScale)).to.equal(rawValue);
		}
	});

	it("keeps 10,000 deterministic unsigned 32-bit combinations positive and exact", () => {
		let seed = 0x12345678;
		const nextWord = (): number => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return seed & 0xffff;
		};
		for (let index = 0; index < 10000; index++) {
			const hi = nextWord();
			const lo = nextWord();
			expect(to32bitNumber(hi, lo)).to.equal(hi * 0x10000 + lo);
		}
	});

	it("validates 16-bit text conversion", () => {
		expect(wordString(0x8000)).to.equal("1000000000000000");
		expect(() => wordString(-1)).to.throw();
		expect(() => wordString(0x10000)).to.throw();
		expect(() => wordString(1.5)).to.throw();
	});
});
