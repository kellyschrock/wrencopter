'use strict'

const SHOT_ID = "orbit";

const ORBIT_MIN_SPEED = 1;
const ORBIT_MAX_SPEED = 8;
const ORBIT_RAD_FOR_MIN_SPEED = 2.0;
const ORBIT_RAD_FOR_MAX_SPEED = 30.0;
const MIN_TARGET_DISTANCE = 1;

const DIR_NONE = 0;
const DIR_FWD = 1;
const DIR_REV = 2;

let ATTRS;
let Vehicle;
let WorkerUI;
let VehicleState;
let MavlinkCommands;
let MathUtils;

// Listener for this shot.
let mListener;

let mVehicleLocation;
let mShotRunning = false;

const mShotParams = {
    radius: 20,
    speed: 2
};

let mPath = null;
let mMinTargetDistance = MIN_TARGET_DISTANCE;
let mPathIndex = 0;
let mDirection = DIR_NONE;
let mTargetPoint = null;
let mROIPoint = null;

const VERBOSE = false;

function d(str) {
    if(VERBOSE) console.log(`shot_orbit: ${str}`);
}

//
// Public interface
//
function init(attrs, listener) {
    d(`init()`);

    ATTRS = attrs;
    WorkerUI = attrs.api.WorkerUI;
    Vehicle = attrs.api.Vehicle;
    VehicleState = attrs.api.VehicleState;
    MavlinkCommands = attrs.api.MavlinkCommands;
    MathUtils = attrs.api.MathUtils;

    mListener = listener;
}

function initShotPanel(body) {
    const radius = WorkerUI.findViewById(body.layout, "txt_radius", true);
    const skRadius = WorkerUI.findViewById(body.layout, "seek_radius", true);
    const speed = WorkerUI.findViewById(body.layout, "txt_speed", true);
    const skSpeed = WorkerUI.findViewById(body.layout, "seek_speed", true);

    if (radius) radius.text = mShotParams.radius + " m";
    if (skRadius) skRadius.progress = mShotParams.radius;

    if (speed) speed.text = mShotParams.speed + " m/s";
    if (skSpeed) skSpeed.progress = mShotParams.speed;

    return body;
}

function onGCSMessage(msg) {
    d(`onGCSMessage(${JSON.stringify(msg)})`);

    if(!msg) {
        return { ok: false, message: "No message"};
    }

    d(`onGCSMessage(): ${JSON.stringify(msg)}`);

    const result = { ok: true };

    switch(msg.id) {
        // User closed the panel. If running the shot, immediately stop.
        case "orbit_panel_closed": {
            if(mShotRunning) {
                stop();
            } else {
                d("Shot is not running");
            }

            mListener.onShotPanelClosed();

            break;
        }

        case "orbit_radius_updated": {
            if(msg.radius >= 3)  {
                const oldRadius = mShotParams.radius;

                mShotParams.radius = msg.radius;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "orbit_shot",
                    values: {
                        txt_radius: {
                            text: mShotParams.radius + " m"
                        }
                    }
                });

                if (mShotRunning) {
                    updateRunningRadius(oldRadius);
                }
            }

            break;
        }

        case "orbit_speed_updated": {
            mShotParams.speed = msg.speed;

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "orbit_shot",
                values: {
                    txt_speed: {
                        text: mShotParams.speed + " m/s"
                    }
                }
            });

            if(mShotRunning) {
                Vehicle.setSpeed(getShotSpeed());
            }

            break;
        }

        case "orbit_go_reverse": {
            mDirection = DIR_REV;
            headToNextLocation();
            break;
        }

        case "orbit_go_pause": {
            mDirection = DIR_NONE;
            headToNextLocation();
            break;
        }

        case "orbit_go_forward": {
            mDirection = DIR_FWD;
            headToNextLocation();
            break;
        }

        case "orbit_start_shot": {
            mListener.onShotStart();
            break;
        }

        default: {
            result.ok = false;
            result.message = `No message with id ${msg.id}`;
            break;
        }
    }

    return result;
}

function start() {
    d(`start()`);

    startShot(mShotParams);
}

function stop() {
    d(`stop()`);

    stopShot();
}

function isRunning() { 
    return mShotRunning; 
}

function generateROI(paramsArg) {
    const params = paramsArg || mShotParams;

    const heading = getVehicleHeading();
    if (heading == undefined) {
        onShotError("No vehicle heading");
        return null;
    }

    // shot params
    const radius = params.radius || 10;

    // Set a ROI at the center of the circle, based on radius
    const roiPoint = MathUtils.newCoordFromBearingAndDistance(mVehicleLocation, heading, radius);
    roiPoint.alt = 1;
    d(`heading=${heading}, roiPoint=${JSON.stringify(roiPoint)}`);

    return roiPoint;
}

// Starts the shot.
function startShot(params) {
    d(`startShot(): params=${JSON.stringify(params)}`);

    if(!params) {
        return onShotError("No shot params");
    }

    if(!mVehicleLocation) {
        return onShotError("No vehicle position");
    }

    const roiPoint = generateROI(params);

    if(!roiPoint) return onShotError("Unable to generate ROI");

    mROIPoint = roiPoint;

    const radius = params.radius || 10;
    const heading = getVehicleHeading();

    mPath = generatePath(roiPoint, mVehicleLocation.alt || 10, radius, heading);

    mPathIndex = 0; // First point in the path is the vehicle's current location.

    mListener.onShotStartReady(SHOT_ID);
}

function updateRunningRadius() {
    d("updateRunningRadius()");

    const radius = mShotParams.radius;
    const heading = getVehicleHeading();

    if(!mROIPoint) {
        return d(`OOPS! No ROI point and we're already running?`);
    }

    if(!mROIPoint) return d(`no ROI point`);
    if(!radius) return d(`no radius`);
    if(!heading) return d(`no heading`);

    // Roll through the items in mPath and adjust their radius to the new value.
    for(let i = 0; i < mPath.length; ++i) {
        const pt = mPath[i];
        const rh = MathUtils.getHeadingFromCoordinates(mROIPoint, pt);
        const np = MathUtils.newCoordFromBearingAndDistance(mROIPoint, rh, radius);
        mPath[i] = np;
    }
}

function getVehicleHeading() {
    const state = Vehicle.getState();

    if(!state) return undefined;
    const yaw = (state.attitude)? state.attitude.yaw: undefined;
    if(!yaw) return undefined;

    return yawToHeading(yaw);
}

/**
 * 
 * @param {latlong} roiPoint the ROI point in this shot.
 * @param {double} radius Circle radius.
 * @param {double} alt Vehicle altitude.
 * @param {double} heading Heading from the vehicle to the ROI point.
 */
function generatePath(roiPoint, alt, radius, heading) {
    const path = [];

    // Make a path around the ROI point at $radius every n degrees. Start with the current heading and loop around 
    // to the same point.
    const circum = radius * 2.0 * Math.PI;
    const arcLen = ((1 / 360) * circum) * 4;
    const totalSteps = (circum / arcLen);
    const stepSize = (360 / totalSteps);
    d(`circum=${circum} arcLen=${arcLen} stepSize=${stepSize}`);

    // Invert the heading to get from the ROI to the vehicle
    let deg = (heading + 180);
    if (deg > 360) deg -= 360;

    for(let i = 0; i < totalSteps; ++i) {
        const point = MathUtils.newCoordFromBearingAndDistance(roiPoint, deg, radius);
        d(`point=${JSON.stringify(point)}`);
        if (!point) break;

        point.alt = alt;
        path.push(point);
        deg += stepSize;
        if (deg >= 360) deg -= 360;
    }

    mMinTargetDistance = arcLen;
    return path;
}

function stopShot() {
    d("stopShot()");

    // Clear the ROI
    Vehicle.clearROI();
    
    if(mShotRunning) {
        mListener.onShotStopped(SHOT_ID);
        mShotRunning = false;
        mTargetPoint = null;
        mROIPoint = null;
    }
}

function isRunning() {
    return mShotRunning;
}

function onVehicleMoved(where) {
    d(`onVehicleMoved(): where=${JSON.stringify(where)}`);

    if(!where) {
        return onShotError("Moved: No vehicle location");
    }

    mVehicleLocation = where;

    if(mTargetPoint != null) {
        const distToTarget = MathUtils.getDistance2D(mVehicleLocation, mTargetPoint);
        // d(`distToTarget=${distToTarget}`);

        if (isValidDistance(distToTarget)) {
            // If we've gotten near the target point, go to the next one.
            // Keep doing this until the user hits stop or changes modes.
            if (distToTarget <= (mMinTargetDistance * (getShotSpeed()))) {
                headToNextLocation();
            }
        } else {
            d(`Invalid distance ${distToTarget}`);
        }
    }
}

function isValidDistance(dist) {
    return (dist > -1 && !isNaN(dist));
}

function getShotInfo() {
    d("getShotInfo()");

    return {
        // Id for this shotInfo
        id: "orbit",
        // Shot name
        name: "Orbit",
        description: "Orbits around a point at the given radius and speed",
    }
}

function onEnteredGuidedMode(mode) {
    d("onEnteredGuidedMode()");

    if(mROIPoint) {
        d(`setROI(): ${JSON.stringify(mROIPoint)}`);
        Vehicle.setROI(mROIPoint);
    }

    if(!mPath) {
        return onShotError("No path to follow");
    }

    mDirection = DIR_NONE;
    // Do nothing here... The user has to press FWD or REV to get anything to happen.
    mShotRunning = true;
    mListener.onShotMessage(SHOT_ID, "Press forward or reverse to start moving");
}

// Starts toward the next target location
function headToNextLocation() {
    mTargetPoint = nextLocation();
    d(`headToNextLocation(): mTargetPoint=${JSON.stringify(mTargetPoint)}`);

    if (mTargetPoint) {
        Vehicle.gotoPoint(mTargetPoint);

        if(mROIPoint) {
            Vehicle.setROI(mROIPoint);
        }

        Vehicle.setSpeed(getShotSpeed());
    }
}

function getShotSpeed() {
    let speed = Math.min(mShotParams.speed || 2, maxStrafeSpeed(mShotParams.radius));
    if(isNaN(speed)) speed = 1;
    return speed;
}

function nextLocation() {
    if(!mPath) return null;

    switch(mDirection) {
        case DIR_FWD: {
            if (++mPathIndex >= (mPath.length - 1)) mPathIndex = 0;
            break;
        }

        case DIR_REV: {
            if(--mPathIndex < 0) mPathIndex = (mPath.length - 1);
            break;
        }

        default: {
            // DIR_NONE
            return null;
        }
    }

    const item = mPath[mPathIndex];
    // If this was spliced in for spiraling, remove it as we hit it.
    if(item && item.spliced) {
        const idx = mPath.indexOf(item);
        mPath.splice(idx, 1);
    }

    return item;
}

function yawToHeading(yaw) {
    let heading = yaw;

    if (heading < 0) {
        heading += 360;
    }

    return heading;
}

function onShotError(msg) {
    mListener.onShotError(SHOT_ID, { message: msg });
    mShotRunning = false;
}

function maxStrafeSpeed(radius) {
    let maxSpeed = ORBIT_MAX_SPEED;

    if(radius < ORBIT_RAD_FOR_MIN_SPEED)
        maxSpeed = ORBIT_MIN_SPEED;
    else if(radius >= ORBIT_RAD_FOR_MAX_SPEED)
        maxSpeed = ORBIT_MAX_SPEED
    else {
        const ratio = (radius - ORBIT_RAD_FOR_MIN_SPEED) / (ORBIT_RAD_FOR_MAX_SPEED - ORBIT_RAD_FOR_MIN_SPEED);
        maxSpeed = ORBIT_MIN_SPEED + ((ORBIT_MAX_SPEED - ORBIT_MIN_SPEED) * ratio);
    }

    return maxSpeed;
}

exports.init = init;
exports.getShotInfo = getShotInfo;
exports.initShotPanel = initShotPanel;
exports.onEnteredGuidedMode = onEnteredGuidedMode;
exports.onGCSMessage = onGCSMessage;
exports.start = start;
exports.stop = stop;
exports.isRunning = isRunning;
exports.onVehicleMoved = onVehicleMoved;

exports.test = function(state) {
    testPathGen(state);
    // testStrafeSpeed(state);
};

function testPathGen(state) {
    // shot params
    const radius = 10;
    const heading = state.vehicle_heading || 90;
    const where = state.location;

    // Set a ROI at the center of the circle, based on radius
    const roiPoint = MathUtils.newCoordFromBearingAndDistance(where, heading, radius);
    d(`heading=${heading}, roiPoint=${JSON.stringify(roiPoint)}`);

    // Test different radii
    [radius].map(function (radius) {
        const path = generatePath(roiPoint, where.alt || 10, radius, heading);
        d(`path.length=${path.length}`);

        let str = `${state.location.lat}\t${state.location.lng}\tdot3\tred\t0\tVehicle\n`;
        str += `${roiPoint.lat}\t${roiPoint.lng}\tdot3\tgreen\t0\tROI\n`;
        let number = 0;
        path.map(function (pt) {
            str += (`${pt.lat}\t${pt.lng}\tnumbered\tyellow\t${++number}\t${pt.alt.toFixed(2)}\n`);
        });

        d(str);

        // mPath = path;

        // mDirection = DIR_FWD;
        // let i = 0;
        // while(i++ < 10) {
        //     const next = nextLocation();
        //     d(`next=${JSON.stringify(next)}`);
        // }

        // mDirection = DIR_REV;
        // i = 0;
        // while(i++ < 10) {
        //     const next = nextLocation();
        //     d(`next=${JSON.stringify(next)}`);
        // }
    });
}

function testStrafeSpeed() {
    [3, 10, 100].map(function(radius) {
        const speed = maxStrafeSpeed(radius);
        d(`speed=${speed}`);
    });
}

