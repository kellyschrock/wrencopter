'use strict'

function d(str) { console.log(`${require("path").basename(__filename, ".js")}: ${str}`); }
function e(str) { console.error(`${require("path").basename(__filename, ".js")}: ${str}`); }

const TIMEOUT = 200;

let MathUtils = null;

exports.setAPI = (api) => {
    MathUtils = api.MathUtils;
}

class ROIEstimator {
    constructor(listener) {
        if (!listener) throw new Error("Listener is required");

        this.listener = listener;
        this.lastLocation = null;
        this.timerHandle = null;
    }

    onLocationUpdated(where) {
        // d(`onLocationUpdated()`);

        if(!where) return d(`No location`);

        const now = Date.now();

        if(this.lastLocation) {
            if (this.lastLocation.when && where.speed && where.heading) {
                this.lastLocation.bearing = where.heading;
                this.lastLocation.speed = where.speed;
            }

            if (this.lastLocation.speed == undefined) {
                const distance = MathUtils.getDistance2D(where, this.lastLocation);
                const speed = ((distance * 1000) / (now - this.lastLocation.when)); // mm/ms
                this.lastLocation.speed = speed;
            }

            this.updateROI();
        }

        this.lastLocation = where;
        this.lastLocation.when = now;
    }

    updateROI() {
        const gcsCoord = this.lastLocation;
        if(!gcsCoord) return;

        const now = Date.now();

        if((now - gcsCoord.when) > 6000) {
            d(`Something has gone dead. Stopping`);
            clearTimeout(this.timerHandle);
            return;
        }

        const bearing = gcsCoord.heading;
        const distSinceLast = gcsCoord.speed * (now - this.lastLocation.when) / 1000;
        const goCoord = MathUtils.newCoordFromBearingAndDistance(gcsCoord, bearing, distSinceLast);
        goCoord.heading = gcsCoord.heading;
        goCoord.speed = gcsCoord.speed;

        if(this.listener.onROIUpdate) this.listener.onROIUpdate(goCoord);

        clearTimeout(this.timerHandle);
        if(gcsCoord.speed > 0) {
            this.timerHandle = setTimeout(this.updateROI.bind(this), TIMEOUT);
        }
    }

    stop() {
        d(`stop()`);
        clearTimeout(this.timerHandle);
    }
}

exports.ROIEstimator = ROIEstimator;
