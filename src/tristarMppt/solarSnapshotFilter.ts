export interface SolarSnapshot {
	current: number;
	power: number;
}

/** Median-of-three over complete, consecutive solar poll snapshots. */
export class SolarSnapshotFilter {
	private snapshots: SolarSnapshot[] = [];
	private scaleSignature: string | undefined;

	add(scaleSignature: string, snapshot: SolarSnapshot): SolarSnapshot | null {
		if (!Number.isFinite(snapshot.current) || !Number.isFinite(snapshot.power)) {
			this.reset();
			return null;
		}
		if (this.scaleSignature !== scaleSignature) {
			this.reset();
			this.scaleSignature = scaleSignature;
		}
		this.snapshots.push(snapshot);
		if (this.snapshots.length > 3) {
			this.snapshots.shift();
		}
		if (this.snapshots.length < 3) {
			return null;
		}
		return {
			current: this.median(this.snapshots.map(item => item.current)),
			power: this.median(this.snapshots.map(item => item.power)),
		};
	}

	reset(): void {
		this.snapshots = [];
		this.scaleSignature = undefined;
	}

	private median(values: number[]): number {
		const sorted = [...values].sort((a, b) => a - b);
		return sorted[1];
	}
}
