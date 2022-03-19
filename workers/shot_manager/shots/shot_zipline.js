'use strict'

const SHOT_ID = "zipline";

const MIN_SPEED = 1;
const MAX_SPEED = 12;
const TARGET_DISTANCE = 40;
const DEF_START_MSG = "Zipline started. Yaw to new direction and press start again to change direction.";

let ATTRS;
let Vehicle;
let WorkerUI;
let VehicleState;
let MavlinkCommands;
let MathUtils;

// Listener for this shot.
let mListener;

let mVehicleLocation;
let mVehicleHeading;
let mShotRunning = false;
let mStartMessage = DEF_START_MSG;

const mShotParams = {
    speed: 2
};

let mMinTargetDistance = TARGET_DISTANCE;
let mTargetPoint = null;

const VERBOSE = true;

function d(str) {
    if(VERBOSE) console.log(`shot_zipline: ${str}`);
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
}

function initShotPanel(body) {
    const speed = WorkerUI.findViewById(body.layout, "txt_speed", true);
    const skSpeed = WorkerUI.findViewById(body.layout, "seek_speed", true);

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
        case "zipline_panel_closed": {
            if(mShotRunning) {
                stop();
            } else {
                d("Shot is not running");
            }

            mListener.onShotPanelClosed();

            break;
        }

        case "zipline_speed_updated": {
            mShotParams.speed = msg.speed;

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "zipline_shot",
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

        case "zipline_start_shot": {
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

function generateTargetPoint() {
    const heading = getVehicleHeading();
    if (heading == undefined) {
        onShotError("No vehicle heading");
        return null;
    }

    mVehicleHeading = heading;

    const point = MathUtils.newCoordFromBearingAndDistance(mVehicleLocation, heading, TARGET_DISTANCE);
    point.alt = mVehicleLocation.alt + 1;
    d(`heading=${heading}, roiPoint=${JSON.stringify(point)}`);

    return point;
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

    const targetPoint = generateTargetPoint();

    if(!targetPoint) return onShotError("Unable to generate target point");

    mTargetPoint = targetPoint;

    const heading = getVehicleHeading();
    if(heading == undefined) return onShotError("Unable to get vehicle heading");

    mVehicleHeading = heading;

    mStartMessage = (mShotRunning)? `New heading, ${mVehicleHeading.toFixed(0)} degrees`: DEF_START_MSG;

    mListener.onShotStartReady(SHOT_ID);
}

function getVehicleHeading() {
    const state = Vehicle.getState();

    if(!state) return undefined;
    const yaw = (state.attitude)? state.attitude.yaw: undefined;
    if(!yaw) return undefined;

    return yawToHeading(yaw);
}

function stopShot() {
    d("stopShot()");

    // Clear the ROI
    Vehicle.clearROI();
    
    if(mShotRunning) {
        mListener.onShotStopped(SHOT_ID);
        mShotRunning = false;
        mTargetPoint = null;
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
    return {
        // Id for this shotInfo
        id: "zipline",
        // Shot name
        name: "Zipline",
        description: "Flies in a straight line, allowing you to yaw freely without having to maintain a straight path.",
    }
}

function onEnteredGuidedMode(mode) {
    d("onEnteredGuidedMode()");

    // Do nothing here... The user has to press FWD or REV to get anything to happen.
    mShotRunning = true;
    mListener.onShotMessage(SHOT_ID, mStartMessage);
    headToNextLocation();
}

// Starts toward the next target location
function headToNextLocation() {
    mTargetPoint = nextLocation();
    d(`headToNextLocation(): mTargetPoint=${JSON.stringify(mTargetPoint)}`);

    if (mTargetPoint) {
        Vehicle.gotoPoint(mTargetPoint);
        Vehicle.setSpeed(getShotSpeed());
    }
}

function getShotSpeed() {
    return mShotParams.speed;
}

function nextLocation() {
    const pos = MathUtils.newCoordFromBearingAndDistance(mVehicleLocation, mVehicleHeading, (mMinTargetDistance * 2) * getShotSpeed());
    pos.alt = mVehicleLocation.alt;
    return pos;
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

exports.init = init;
exports.getShotInfo = getShotInfo;
exports.initShotPanel = initShotPanel;
exports.onEnteredGuidedMode = onEnteredGuidedMode;
exports.onGCSMessage = onGCSMessage;
exports.start = start;
exports.stop = stop;
exports.isRunning = isRunning;
exports.onVehicleMoved = onVehicleMoved;

const testShotMath = function(state) {
    const utils = require('./utils');
    utils.init({ MathUtils: MathUtils });

    const pos = { lat: state.location.lat, lng: state.location.lng, alt: 20 };

    d(`state.location=${JSON.stringify(state.location)}`);

    [0, 10, 20, 30, 45, 50, 60, 70, 80, 90].map(function(angle) {
        const roi = utils.calcFromPosition({
            vehicle_pos: pos,
            gimbal_angle: angle,
            heading: 180
        });

        d(`roi=${JSON.stringify(roi)} distance=${MathUtils.getDistance2D(roi, pos)}`);
    });
}

exports.test = function(state) {
    testShotMath(state);
};

