'use strict'

const SHOT_ID = "selfie";
const ENDPOINT_DISTANCE = 1; // meters
const MIN_TARGET_DISTANCE = 2; // meters

let ATTRS;
let Vehicle;
let WorkerUI;
let VehicleState;
let MavlinkCommands;
let MathUtils;

// Listener for this shot.
let mListener;

let mEndPoint;  // Start/end vehicle position
let mFarPoint;  // Far-side target location/altitude
let mTargetPoint; // where we're currently headed.
let mROIPoint; 
let mVehicleLocation;
let mShotRunning = false;

const mShotParams = {
    distance: 10,
    altitude: 10,
    speed: 1
};

const VERBOSE = false;
function d(str) {
    if(VERBOSE) console.log(`shot_selfie: ${str}`);
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
    const distance = WorkerUI.findViewById(body.layout, "txt_distance", true);
    const skDistance = WorkerUI.findViewById(body.layout, "seek_distance", true);
    const alt = WorkerUI.findViewById(body.layout, "txt_altitude", true);
    const skAlt = WorkerUI.findViewById(body.layout, "seek_altitude", true);
    const speed = WorkerUI.findViewById(body.layout, "txt_speed", true);
    const skSpeed = WorkerUI.findViewById(body.layout, "seek_speed", true);

    if (distance) distance.text = mShotParams.distance + " m";
    if (skDistance) skDistance.progress = mShotParams.distance;

    if (alt) alt.text = mShotParams.altitude + " m";
    if (skAlt) skAlt.progress = mShotParams.altitude;

    if (speed) speed.text = mShotParams.speed + " m/s";
    if (skSpeed) skSpeed.progress = mShotParams.speed;

    mFarPoint = null;
    mEndPoint = null;
    mTargetPoint = null;

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
        case "selfie_panel_closed": {
            if(mShotRunning) {
                stop();
            } else {
                d("Selfie is not running");
            }

            mListener.onShotPanelClosed();

            break;
        }

        case "selfie_distance_updated": {
            mShotParams.distance = msg.distance;

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "selfie_shot",
                values: {
                    txt_distance: {
                        text: mShotParams.distance + " m"
                    }
                }
            });

            break;
        }

        case "selfie_altitude_updated": {

            mShotParams.altitude = msg.altitude;

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "selfie_shot",
                values: {
                    txt_altitude: {
                        text: mShotParams.altitude + " m"
                    }
                }
            });

            break;
        }

        case "selfie_speed_updated": {
            mShotParams.speed = msg.speed;

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "selfie_shot",
                values: {
                    txt_speed: {
                        text: mShotParams.speed + " m/s"
                    }
                }
            });

            if(mShotRunning) {
                Vehicle.setSpeed(msg.speed);
            }

            break;
        }

        case "selfie_start_shot": {
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

    const state = Vehicle.getState();
    if(!state) {
        return onShotError("No vehicle state");
    }

    const yaw = (state.attitude)? state.attitude.yaw: undefined;
    if(!yaw) return onShotError("No vehicle yaw");

    // distance, altitude, speed
    const distance = params.distance || 10;
    const altitude = params.altitude || 20;
    const speed = params.speed || 2;

    // Save vehicle position as endPoint
    mEndPoint = {
        lat: mVehicleLocation.lat,
        lng: mVehicleLocation.lng,
        alt: mVehicleLocation.alt,
        speed: speed
    };

    d(`mEndPoint=${JSON.stringify(mEndPoint)}`);

    // Set an ROI 1m in front of the vehicle's position.
    const heading = yawToHeading(yaw);
    const roiPoint = MathUtils.newCoordFromBearingAndDistance(mVehicleLocation, heading, ENDPOINT_DISTANCE);
    roiPoint.alt = 2; // More or less at the ground.
    d(`yaw=${yaw}, heading=${heading}, roiPoint=${JSON.stringify(roiPoint)}`);

    mROIPoint = roiPoint;
    Vehicle.setROI(roiPoint);

    // Set a target point at $(distance/alt) behind vehicles position.
    let farHeading = (heading + 180);
    if(farHeading >= 360) farHeading -= 360;
    d(`farHeading=${farHeading}`);

    mFarPoint = MathUtils.newCoordFromBearingAndDistance(mVehicleLocation, farHeading, distance);
    mFarPoint.alt = altitude;
    mFarPoint.speed = speed;
    d(`mFarPoint=${JSON.stringify(mFarPoint)}`);

    mTargetPoint = mFarPoint;

    if(!mFarPoint || !mEndPoint) {
        return onShotError("Unable to make start and end points");
    }

    mListener.onShotStartReady(SHOT_ID);
}

function stopShot() {
    d("stopShot()");

    if(mShotRunning) {
        // Clear the ROI
        Vehicle.clearROI();

        mListener.onShotStopped(SHOT_ID);
        mShotRunning = false;
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

    if (!mTargetPoint) {
        return d(`no target point`);
    }

    const distToTarget = MathUtils.getDistance2D(mVehicleLocation, mTargetPoint);
    d(`distToTarget=${distToTarget}`);

    // mListener.onShotMessage(SHOT_ID, `Target is ${distToTarget.toFixed(0)} meters away`);

    if(isValidDistance(distToTarget)) {
        if(distToTarget <= MIN_TARGET_DISTANCE) {
            if (mTargetPoint == mFarPoint) {
                onHitFarPoint();
            } else if (mTargetPoint == mEndPoint) {
                onHitEndPoint();
            }
        } else {
            // mListener.onShotMessage(SHOT_ID, "Invalid distance");
        }
    }
}

function isValidDistance(dist) {
    return (dist > -1 && !isNaN(dist));
}

function onHitFarPoint() {
    d(`onHitFarPoint(): arrived=${mFarPoint.arrived}`);
    if(mFarPoint.arrived) return;
    mFarPoint.arrived = true;

    // Pause, then start toward mEndPoint
    setTimeout(function () {
        mTargetPoint = mEndPoint;
        gotoPoint(mTargetPoint);
    }, 3000);
}

function onHitEndPoint() {
    d(`onHitEndPoint(): arrived=${mEndPoint.arrived}`);
    if(mEndPoint.arrived) return;
    mEndPoint.arrived = true;

    // Clear the ROI
    Vehicle.clearROI();
    // Tell ShotManager we're done.
    mListener.onShotComplete(SHOT_ID);
    mShotRunning = false;
}

function getShotInfo() {
    d("getShotInfo()");

    return {
        // Id for this shotInfo
        id: "selfie",
        // Shot name
        name: "Selfie",
        description: "Focuses on a point in front of the vehicle, flies up and away from it in reverse, then back to the start point.",
    }
}

function onEnteredGuidedMode(mode) {
    d("onEnteredGuidedMode()");

    if(mROIPoint) {
        Vehicle.setROI(mROIPoint);
    }

    if(mFarPoint) {
        gotoPoint(mFarPoint);
        mShotRunning = true;
        mListener.onShotStarted(SHOT_ID);
    } else {
        onShotError("No far point");
    }
}

function gotoPoint(where) {
    d(`gotoPoint(): where=${JSON.stringify(where)}`);

    if(!where) {
        return onShotError("No point to go to");
    }

    Vehicle.gotoPoint(where);
    if (where.speed) {
        Vehicle.setSpeed(where.speed);
    }
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

exports.test = function(state) {
    d(`test()`);
};

