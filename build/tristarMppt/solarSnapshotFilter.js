"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolarSnapshotFilter = void 0;
/** Median-of-three over complete, consecutive solar poll snapshots. */
class SolarSnapshotFilter {
    constructor() {
        this.snapshots = [];
    }
    add(scaleSignature, snapshot) {
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
    reset() {
        this.snapshots = [];
        this.scaleSignature = undefined;
    }
    median(values) {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[1];
    }
}
exports.SolarSnapshotFilter = SolarSnapshotFilter;
//# sourceMappingURL=solarSnapshotFilter.js.map