// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			hostname: string;
			port: number;
			unitId: number;
			interval: number;
			installedWP: number;
			enableControlWrites: boolean;
			enableEepromWrites: boolean;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};