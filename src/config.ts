export function validateConfig(config: ioBroker.AdapterConfig): void {
	const hostname = String(config.hostname ?? "").trim();
	const port = Number(config.port);
	const unitId = Number(config.unitId);
	const interval = Number(config.interval);
	const installedWP = Number(config.installedWP);

	if (!hostname) {
		throw new Error("Hostname must not be empty");
	}
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("Port must be an integer between 1 and 65535");
	}
	if (!Number.isInteger(unitId) || unitId < 1 || unitId > 247) {
		throw new Error("Unit ID must be an integer between 1 and 247");
	}
	if (!Number.isFinite(interval) || interval < 1) {
		throw new Error("Polling interval must be at least 1 second");
	}
	if (!Number.isFinite(installedWP) || installedWP < 0) {
		throw new Error("Installed Wp must be a non-negative number");
	}

	config.hostname = hostname;
	config.port = port;
	config.unitId = unitId;
	config.interval = interval;
	config.installedWP = installedWP;
}
