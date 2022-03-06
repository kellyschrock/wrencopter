'use strict';

const path = require("path");
const roi_estimator = require("./ROIEstimator");
const { ROIEstimator } = roi_estimator;

function d(str) { console.log(`${path.basename(__filename, ".js")}: ${str}`); }
function e(str) { console.log(`${path.basename(__filename, ".js")}: ${str}`); }

function addAngle(heading, angle) {
    let out = parseFloat(heading) + parseFloat(angle);
    if (out >= 360) out -= 360;
    if (out < 0) out += 360;
    return out;
}

let MathUtils = null;
let Vehicle = null;

exports.setAPI = (api) => {
    MathUtils = api.MathUtils;
    Vehicle = api.Vehicle;
    roi_estimator.setAPI(api);
}

class FollowAlgo {
    static forOptions(param) {
        const distance = param.distance || 5;
        const look = param.look || false;
        const useEstimator = param.use_estimator || false;

        switch(param.type) {
            case "ahead": return new FollowAhead(distance, look, useEstimator);
            case "left": return new FollowLeft(distance, look, useEstimator);
            case "right": return new FollowRight(distance, look, useEstimator);
            case "behind": return new FollowBehind(distance, look, useEstimator);
            case "path": return new FollowPath(distance, useEstimator);
            default: return null;
        }
    }

    constructor(distance, useEstimator) {
        this.distance = distance;

        this.lastUpdateTime = 0;
        this.estimator = null;
        
        this.estimator = (useEstimator) ? new ROIEstimator({
            onROIUpdate: (roi) => {
                this.handleROIUpdate(roi);
            }
        }) : null;
    }

    stop() {
        d(`${this.constructor.name}::stop()`);
        if (this.estimator && this.estimator.stop) {
            this.estimator.stop();
        }
    }

    processLocation(myLocation, otherLocation) { }

    handleROIUpdate(roi) { }
}

class FollowAngle extends FollowAlgo {
    constructor(vehicle, distance, angle, look, useEstimator) {
        super(vehicle, distance, useEstimator);
        this.angle = angle;
        this.lookAtTarget = look;
    }

    gotoTarget(target) {
        const heading = target.heading || 0;

        const goAngle = addAngle(heading, this.angle);
        const pt = MathUtils.newCoordFromBearingAndDistance(target, goAngle, this.distance);

        d(`gotoTarget(): distance=${this.distance} target=${JSON.stringify(target)}, pt=${JSON.stringify(pt)}`);
        // d(`gotoTarget(): goAngle=${goAngle}`);

        // if(target.speed) {
        //     VehicleShell.setSpeed(this.vehicle, target.speed);
        // }

        Vehicle.gotoPoint(pt);

        if (this.lookAtTarget) {
            Vehicle.setROI(target);
        } else {
            Vehicle.setYaw(heading);
        }
    }

    handleROIUpdate(target) {
        this.gotoTarget(target);
    }

    processLocation(here, target) {
        d(`processLocation(${JSON.stringify(here)}, ${JSON.stringify(target)})`);

        if (!target.hasOwnProperty("heading")) {
            // Point at the target vehicle instead of angling to match it.
            there.heading = MathUtils.getHeadingFromCoordinates(here, there);
        }
        
        const distance = MathUtils.getDistance2D(here, target);

        if (distance < this.distance) {
            d(`Too close, ${distance}m vs ${this.distance}m`);
        }

        if (this.estimator) {
            const now = Date.now();
            if ((now - this.lastUpdateTime) > ESTIMATOR_INTERVAL) {
                this.estimator.onLocationUpdated(target);
                this.lastUpdateTime = now;
            }
        } else {
            this.gotoTarget(target);
        }
    }
}

class FollowLeft extends FollowAngle {
    constructor(distance, look, useEstimator) {
        super(distance, -90, look, useEstimator);
    }
}

class FollowRight extends FollowAngle {
    constructor(distance, look, useEstimator) {
        super(distance, 90, look, useEstimator);
    }
}

class FollowAhead extends FollowAngle {
    constructor(distance, look, useEstimator) {
        super(distance, 0, look, useEstimator);
    }
}

class FollowBehind extends FollowAngle {
    constructor(distance, look, useEstimator) {
        super(distance, 180, look, useEstimator);
    }

    processLocation(here, there) {
        super.processLocation(here, there);
    }
}

class FollowPath extends FollowAlgo {
    constructor(distance, useEstimator) {
        super(distance, useEstimator);

        this.path = [];
        this.currTarget = null;
        this.lastUpdateTime = 0;
    }

    processLocation(here, target) {
        // d(`processLocation(${JSON.stringify(target)})`);
        const now = Date.now();
        target.when = now;

        if (MathUtils.getDistance2D(here, target) < this.distance) {
            return d(`Too close, min distance is ${this.distance}`);
        }

        if ((now - this.lastUpdateTime) > 2000) {
            this.path.push(target);
            this.lastUpdateTime = now;
        }

        if (this.currTarget) {
            const dist = MathUtils.getDistance2D(here, this.currTarget);
            // d(`dist=${dist}`);

            if (!this.currTarget.speed) {
                this.currTarget.speed = (dist * 1000) / (target.when - this.currTarget.when); // mm/ms
            }

            if (dist < this.distance) {
                d(`Next point of ${this.path.length} points`);
                this.path.splice(0, 1);

                // safety
                if (this.path.length == 0) {
                    d(`Oops, out of points`);
                    this.path.push(target);
                }

                if (this.path.length > 0) {
                    const goThere = this.path[0];

                    if (this.estimator) {
                        if ((now - this.lastUpdateTime) > ESTIMATOR_INTERVAL) {
                            this.estimator.onLocationUpdated(goThere);
                        }
                    } else {
                        this.gotoTarget(goThere);
                    }
                }
            }
        } else {
            d(`Go to first of ${this.path.length} points`);
            this.gotoTarget(this.path[0]);
        }
    }

    handleROIUpdate(target) {
        d(`handleROIUpdate(${JSON.stringify(target)})`);
        this.gotoTarget(target);
    }

    // Don't really need this, since we get "here" in processLocation().
    onLocalPositionChanged(where) { }

    gotoTarget(target) {
        this.currTarget = target;
        const heading = target.heading || 0;

        const pt = MathUtils.newCoordFromBearingAndDistance(target, heading, this.distance);

        Vehicle.gotoPoint(pt);
        Vehicle.setROI(target);
    }
}

exports.FollowAlgo = FollowAlgo;
