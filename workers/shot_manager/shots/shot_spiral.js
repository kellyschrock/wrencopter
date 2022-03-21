'use strict'

const SHOT_ID = "spiral";

const MIN_SPEED = 1;
const MAX_SPEED = 10;
const RAD_FOR_MIN_SPEED = 2.0;
const RAD_FOR_MAX_SPEED = 30.0;
const MIN_TARGET_DISTANCE = 0.5;

const { LocationFlow, DIR_FWD, DIR_REV, DIR_NONE } = require("../lib/LocationFlow");

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
let mLocationFlow = null;

const mShotParams = {
    orbits: 2,
    startRadius: 10,
    startAlt: 10,
    endRadius: 30,
    endAlt: 30,
    speed: 4
};

let mPath = null;
let mPathIndex = 0;
let mDirection = DIR_NONE;
let mTargetPoint = null;
let mROIPoint = null;

const VERBOSE = false;
function d(str) {
    if(VERBOSE) console.log(`shot_spiral: ${str}`);
}

//
// Public interface
//
function init(attrs, listener) {
    ATTRS = attrs;
    WorkerUI = attrs.api.WorkerUI;
    Vehicle = attrs.api.Vehicle;
    VehicleState = attrs.api.VehicleState;
    MavlinkCommands = attrs.api.MavlinkCommands;
    MathUtils = attrs.api.MathUtils;

    mListener = listener;

    mLocationFlow = new LocationFlow({
        onComplete: function () {
            // Send the next path segment
            mListener.onShotMessage(SHOT_ID, "Path complete");
        },

        onLocation: function (where, index, count) {
            // d(`onLocation(): send ${JSON.stringify(where)}`);
            Vehicle.gotoPoint(where);
            Vehicle.setROI(mROIPoint);
        }
    });
}

function initShotPanel(body) {
    const startRadius = WorkerUI.findViewById(body.layout, "txt_start_radius", true);
    const startAlt = WorkerUI.findViewById(body.layout, "txt_start_alt", true);
    const endRadius = WorkerUI.findViewById(body.layout, "txt_end_radius", true);
    const endAlt = WorkerUI.findViewById(body.layout, "txt_end_alt", true);
    const skStartRadius = WorkerUI.findViewById(body.layout, "seek_start_radius", true);
    const skEndRadius = WorkerUI.findViewById(body.layout, "seek_end_radius", true);
    const skStartAlt = WorkerUI.findViewById(body.layout, "seek_start_alt", true);
    const skEndAlt = WorkerUI.findViewById(body.layout, "seek_end_alt", true);
    const speed = WorkerUI.findViewById(body.layout, "txt_speed", true);
    const skSpeed = WorkerUI.findViewById(body.layout, "seek_speed", true);
    const orbits = WorkerUI.findViewById(body.layout, "txt_orbits", true);
    const skOrbits = WorkerUI.findViewById(body.layout, "seek_orbits", true);

    if (startRadius) startRadius.text = mShotParams.startRadius + " m";
    if (startAlt) startAlt.text = mShotParams.startAlt + " m";
    if (endRadius) endRadius.text = mShotParams.endRadius + " m";
    if (endAlt) endAlt.text = mShotParams.endAlt + " m";
    if (skStartRadius) skStartRadius.progress = mShotParams.startRadius;
    if (skStartAlt) skStartAlt.progress = mShotParams.startAlt;
    if (skEndRadius) skEndRadius.progress = mShotParams.endRadius;
    if (skEndAlt) skEndAlt.progress = mShotParams.endAlt;
    if (orbits) orbits.text = mShotParams.orbits;
    if (skOrbits) skOrbits.progress = mShotParams.orbits;

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
        case "spiral_panel_closed": {
            if(mShotRunning) {
                stop();
            } else {
                d("Shot is not running");
            }

            mListener.onShotPanelClosed();

            break;
        }

        case "spiral_start_radius_updated": {
            if(msg.start_radius >= 3)  {
                mShotParams.startRadius = msg.start_radius;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "spiral_shot",
                    values: {
                        txt_start_radius: {
                            text: mShotParams.startRadius + " m"
                        }
                    }
                });
            }

            break;
        }

        case "spiral_start_alt_updated": {
            if(msg.start_alt >= 3)  {
                mShotParams.startAlt = msg.start_alt;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "spiral_shot",
                    values: {
                        txt_start_alt: {
                            text: mShotParams.startAlt + " m"
                        }
                    }
                });
            }

            break;
        }

        case "spiral_end_radius_updated": {
            if(msg.end_radius >= 3)  {
                mShotParams.endRadius = msg.end_radius;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "spiral_shot",
                    values: {
                        txt_end_radius: {
                            text: mShotParams.endRadius + " m"
                        }
                    }
                });
            }

            break;
        }

        case "spiral_end_alt_updated": {
            if(msg.end_alt >= 3)  {
                mShotParams.endAlt = msg.end_alt;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "spiral_shot",
                    values: {
                        txt_end_alt: {
                            text: mShotParams.endAlt + " m"
                        }
                    }
                });
            }

            break;
        }

        case "spiral_orbits_updated": {
            if(msg.orbits >= 1)  {
                mShotParams.orbits = msg.orbits;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "spiral_shot",
                    values: {
                        txt_orbits: {
                            text: mShotParams.orbits
                        }
                    }
                });
            }

            break;
        }

        case "spiral_speed_updated": {
            if(msg.speed >= 1) {
                mShotParams.speed = msg.speed;

                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "spiral_shot",
                    values: {
                        txt_speed: {
                            text: mShotParams.speed + " m/s"
                        }
                    }
                });

                if (mShotRunning) {
                    Vehicle.setSpeed(getShotSpeed());
                }
            }

            break;
        }

        case "spiral_go_reverse": {
            mDirection = DIR_REV;
            mLocationFlow.start(mDirection);
            // headToNextLocation();
            break;
        }

        case "spiral_go_pause": {
            mDirection = DIR_NONE;
            mLocationFlow.pause();
            // headToNextLocation();
            break;
        }

        case "spiral_go_forward": {
            mDirection = DIR_FWD;
            mLocationFlow.start(mDirection);
            // headToNextLocation();
            break;
        }

        case "spiral_start_shot": {
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

// Starts the shot.
function startShot(params) {
    d(`startShot(): params=${JSON.stringify(params)}`);

    if(!params) {
        return onShotError("No shot params");
    }

    if(!mVehicleLocation) {
        return onShotError("No vehicle position");
    }

    const heading = getVehicleHeading();
    if(heading == undefined) {
        return onShotError("No vehicle heading");
    }

    // shot params
    const orbits = params.orbits || 1;
    const startRadius = params.startRadius || 10;
    const endRadius = params.endRadius || 20;
    const startAlt = params.startAlt || 10;
    const endAlt = params.endAlt || 20;

    // Set a ROI at the center of the circle, based on radius
    const roiPoint = MathUtils.newCoordFromBearingAndDistance(mVehicleLocation, heading, startRadius);
    d(`heading=${heading}, roiPoint=${JSON.stringify(roiPoint)}`);

    mROIPoint = roiPoint;

    Vehicle.setROI(roiPoint);

    mPath = generatePath(mROIPoint, orbits, startRadius, startAlt, endRadius, endAlt, heading);

    mPathIndex = 0; // First point in the path is the vehicle's current location.

    const spacing = getSpacingIn(mPath);
    if (spacing == 0) {
        return onShotError(`Cannot get point spacing from path`);
    }

    mLocationFlow
        .setAutoRewind(true)
        .setWaitOnVehicle(true)
        .setPoints(mPath)
        .setPointSpacing(spacing)
        .setTargetSpeed(mShotParams.speed)
        ;

    mListener.onShotStartReady(SHOT_ID);
}

function getSpacingIn(path) {
    return (path.length >= 2) ?
        MathUtils.getDistance2D(path[0], path[1]) : 0;
}

function getVehicleHeading() {
    const state = Vehicle.getState();

    if(!state) return undefined;
    const yaw = (state.attitude)? state.attitude.yaw: undefined;
    if(!yaw) return undefined;

    return yawToHeading(yaw);
}

function generatePath(roiPoint, orbits, startRadius, startAlt, endRadius, endAlt, heading) {
    const path = [];

    // Generate a path starting at startAlt at the current lat/lng, at start radius.
    // Scale radius and altitude to endRadius/endAlt. Spread this out over $orbits orbits.
    const radius = Math.max(startRadius, endRadius);
    const circum = (radius * 2 * Math.PI);
    const slice = 5;
    const circleSteps = Math.max(9, (circum / slice));
    const totalSteps = (circleSteps * orbits);
    const degreeStep = 360 / circleSteps;

    const altStep = (endAlt - startAlt) / totalSteps;
    const radStep = (endRadius - startRadius) / totalSteps;

    let deg = (heading + 180);
    if (deg > 360) deg -= 360;

    for(let i = 0; i < totalSteps; ++i) {
        const point = MathUtils.newCoordFromBearingAndDistance(roiPoint, deg, (startRadius + (radStep * i)));
        point.alt = (startAlt + (altStep * i));
        path.push(point);

        deg += degreeStep;
        if(deg > 360) deg -= 360;
    }

    return path;
}

function stopShot() {
    d("stopShot()");

    if(mShotRunning) {
        // Clear the ROI
        Vehicle.clearROI();

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
    // d(`onVehicleMoved(): where=${JSON.stringify(where)}`);

    if(!where) {
        return onShotError("Moved: No vehicle location");
    }

    mVehicleLocation = where;

    if(mTargetPoint) {
        const distToTarget = MathUtils.getDistance2D(mVehicleLocation, mTargetPoint);
        // d(`distToTarget=${distToTarget}`);

        if (isValidDistance(distToTarget)) {
            // If we've gotten to the target point, go to the next one.
            // Keep doing this until the user hits stop or changes modes.
            if (distToTarget <= (MIN_TARGET_DISTANCE * getShotSpeed())) {
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
        id: "spiral",
        // Shot name
        name: "Spiral",
        description: "Spirals from start radius/alt to end radius/alt, over the specified number of orbits",
    }
}

function onEnteredGuidedMode(mode) {
    d("onEnteredGuidedMode()");

    if(!mPath) {
        return onShotError("No path to follow");
    }

    mDirection = DIR_NONE;
    mShotRunning = true;
    // Do nothing here... The user has to press FWD or REV to get anything to happen.
    mListener.onShotMessage(SHOT_ID, "Press forward or reverse to start moving");
}

// Starts toward the next target location
function headToNextLocation() {
    mTargetPoint = nextLocation();
    d(`headToNextLocation(): mTargetPoint=${JSON.stringify(mTargetPoint)}`);

    if (mTargetPoint) {
        Vehicle.gotoPoint(mTargetPoint);
        Vehicle.setSpeed(getShotSpeed());
        Vehicle.setROI(mROIPoint);
    } else {
        const which = (mDirection == DIR_FWD)? "reverse": "forward";
        mListener.onShotMessage(SHOT_ID, `Reached the end. Press ${which} to go the other way.`);

        // Reset the index so the user can go back the other way.
        mPathIndex = (mDirection == DIR_FWD)? mPath.length - 1: 0;
    }
}

function nextLocation() {
    let result = null;

    switch(mDirection) {
        case DIR_FWD: {
            d(`FORWARD: index=${mPathIndex}`);
            if(mPath && mPathIndex < (mPath.length)) {
                result = mPath[mPathIndex];
                ++mPathIndex;
            }
            break;
        }

        case DIR_REV: {
            d(`REVERSE: index=${mPathIndex}`);
            if(mPath && mPathIndex >= 0) {
                result = mPath[mPathIndex];
                --mPathIndex;
            }
            break;
        }

        default: {
            // DIR_NONE
            result = null;
            break;
        }
    }

    return result;
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
    let maxSpeed = MAX_SPEED;

    if(radius < RAD_FOR_MIN_SPEED)
        maxSpeed = MIN_SPEED;
    else if(radius >= RAD_FOR_MAX_SPEED)
        maxSpeed = MAX_SPEED
    else {
        const ratio = (radius - RAD_FOR_MIN_SPEED) / (RAD_FOR_MAX_SPEED - RAD_FOR_MIN_SPEED);
        maxSpeed = MIN_SPEED + ((MAX_SPEED - MIN_SPEED) * ratio);
    }

    return maxSpeed;
}

function getShotSpeed() {
    const avgRadius = (mShotParams.startRadius + mShotParams.endRadius) / 2;
    let speed = Math.min(mShotParams.speed || 2, maxStrafeSpeed(avgRadius));
    if (isNaN(speed)) speed = 1;
    return speed;
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
};

function testPathGen(state) {
    // shot params
    const orbits = 2;
    const startRadius = 80;
    const endRadius = 10;
    const startAlt = 10;
    const endAlt = 30;
    const heading = state.vehicle_heading || 90;

    // Set a ROI at the center of the circle, based on radius
    const roiPoint = MathUtils.newCoordFromBearingAndDistance(state.location, heading, startRadius);
    d(`heading=${heading}, roiPoint=${JSON.stringify(roiPoint)}`);

    mROIPoint = roiPoint;

    mPath = generatePath(mROIPoint, orbits, startRadius, startAlt, endRadius, endAlt, heading);
    let str = `${state.location.lat}\t${state.location.lng}\tdot3\tred\t0\tVehicle\n`;
    str += `${roiPoint.lat}\t${roiPoint.lng}\tdot3\tgreen\t0\tROI\n`;
    let number = 0;
    mPath.map(function(pt) {
        str += (`${pt.lat}\t${pt.lng}\tnumbered\tyellow\t${++number}\t${pt.alt.toFixed(2)}\n`);
    });
    d(str);

    // d(`mPath=${JSON.stringify(mPath)}`);
}

function test() {
    const radius = 3;
    const speed = maxStrafeSpeed(radius);

    d(`speed=${speed}`);
}

if(process.mainModule == module) test();
