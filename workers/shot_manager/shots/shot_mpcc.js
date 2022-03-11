'use strict'

const SHOT_ID = "mpcc";

const DIR_NONE = 0;
const DIR_FWD = 1;
const DIR_REV = 2;

const MODE_POINTS = 1;
const MODE_RUN = 2;

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

let mDirection = DIR_NONE;

// Run mode
let mRunMode = MODE_POINTS;
// Points saved by the user while building the shot
const mSavedPoints = [];
// Points generated when "Done" is clicked
const mGeneratedPoints = [];
let mPathIndex = 0;
let mTargetPoint = null;

const VERBOSE = true;

function d(str) {
    if(VERBOSE) console.log(`shot_mpcc: ${str}`);
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
    // TODO: Update this
    setRunMode(MODE_POINTS);

    // const radius = WorkerUI.findViewById(body.layout, "txt_radius", true);
    // const skRadius = WorkerUI.findViewById(body.layout, "seek_radius", true);
    // const speed = WorkerUI.findViewById(body.layout, "txt_speed", true);
    // const skSpeed = WorkerUI.findViewById(body.layout, "seek_speed", true);

    // if (radius) radius.text = mShotParams.radius + " m";
    // if (skRadius) skRadius.progress = mShotParams.radius;

    // if (speed) speed.text = mShotParams.speed + " m/s";
    // if (skSpeed) skSpeed.progress = mShotParams.speed;

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
        case "mpcc_panel_closed": {
            if(mShotRunning) {
                stop();
            } else {
                d("Shot is not running");
            }

            mListener.onShotPanelClosed();

            break;
        }

        // User hit "Add Point"
        case "mpcc_add_point": {
            addSavePoint(msg);
            break;
        }

        // User hit "Done" in add-points mode.
        // Send a new screen to the GCS and switch to Guided mode to start the actual shot.
        case "mpcc_add_points_done": {
            setRunMode(MODE_RUN);
            mListener.onShotStart();
            break;
        }

        case "mpcc_speed_updated": {
            updateRunSpeed(msg);
            break;
        }

        case "mpcc_go_reverse": {
            mDirection = DIR_REV;
            headToNextLocation();
            break;
        }

        case "mpcc_go_pause": {
            mDirection = DIR_NONE;
            headToNextLocation();
            break;
        }

        case "mpcc_go_forward": {
            mDirection = DIR_FWD;
            headToNextLocation();
            break;
        }

        case "mpcc_start_shot": {
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

    generateRunPoints();
}

function addSavePoint(msg) {
    d(`updateSavePoint(${JSON.stringify(msg)})`);

    if(!mVehicleLocation) return d(`No vehicle location!`);

    const heading = getVehicleHeading();
    const point = {
        where: mVehicleLocation,
        heading: heading,
        time: Date.now(),
        gimbal: getGimbalAngle()
    };

    mSavedPoints.push(point);
    
}

function updateRunSpeed(msg) {
    d(`updateRunSpeed()`);

    mShotParams.speed = msg.speed;

    mListener.sendGCSMessage({
        id: "screen_update",
        screen_id: "flight",
        panel_id: "mpcc_shot",
        values: {
            txt_speed: {
                text: `${mShotParams.speed} m/s`
            }
        }
    });

    // TODO: Also adjust the timer
    if (mShotRunning) {
        Vehicle.setSpeed(getShotSpeed());
    }
}

function generateRunPoints() {
    if(mSavedPoints.length == 0) {
        d(`generateRunPoints(): No saved points`);
        return false;
    }

    // TODO: Just testing BS for now.
    // Ultimately will be a large set of interpolated points run through by a timer like ROIEstimator.
    for(const point of mSavedPoints) {
        mGeneratedPoints.push({
            lat: point.where.lat,
            lng: point.where.lng,
            alt: point.where.alt,
            yaw: point.heading,
            gimbal: point.gimbal
        });
    }
}

function setRunMode(mode) {
    d(`setRunMode(${mode})`);

    if(mRunMode != mode) {
        switch(mode) {
            case MODE_POINTS: {
                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "mpcc_shot",
                    values: {
                        layout_points: { visibility: "visible" },
                        layout_run: { visibility: "gone" }
                    }
                });

                break;
            }

            case MODE_RUN: {
                mListener.sendGCSMessage({
                    id: "screen_update",
                    screen_id: "flight",
                    panel_id: "mpcc_shot",
                    values: {
                        layout_points: { visibility: "gone" },
                        layout_run: { visibility: "visible" }
                    }
                });

                break;
            }
        }

        mRunMode = mode;
    } else {
        d(`setRunMode(): Already in mode ${mRunMode}`);
    }
}

function getVehicleHeading() {
    const state = Vehicle.getState();

    if(!state) return undefined;
    const yaw = (state.attitude)? state.attitude.yaw: undefined;
    if(!yaw) return undefined;

    return yawToHeading(yaw);
}

function getGimbalAngle() {
    // TODO: Somehow, need to get gimbal angle from the vehicle
    return 0;
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

    // TODO: If actually running the shot:

    // if(mTargetPoint != null) {
    //     const distToTarget = MathUtils.getDistance2D(mVehicleLocation, mTargetPoint);
    //     // d(`distToTarget=${distToTarget}`);

    //     if (isValidDistance(distToTarget)) {
    //         // If we've gotten near the target point, go to the next one.
    //         // Keep doing this until the user hits stop or changes modes.
    //         if (distToTarget <= (mMinTargetDistance * (getShotSpeed()))) {
    //             headToNextLocation();
    //         }
    //     } else {
    //         d(`Invalid distance ${distToTarget}`);
    //     }
    // }
}

function onPanelOpened(body) {
    d(`onPanelOpened()`);

    // TODO: It's saying this twice for some reason.
    // mListener.onShotMessage(SHOT_ID, "Fly to points and save locations by pressing Add Point at each location. Then press Done Adding Points to go to the next step.");
    mSavedPoints.splice(0, mSavedPoints.length);
    mGeneratedPoints.splice(0, mGeneratedPoints.length);
}

function isValidDistance(dist) {
    return (dist > -1 && !isNaN(dist));
}

function getShotInfo() {
    d("getShotInfo()");

    return {
        // Id for this shotInfo
        id: "mpcc",
        // Shot name
        name: "Cable Cam",
        description: "Flies a path of points with style",
    }
}

function onEnteredGuidedMode(mode) {
    d("onEnteredGuidedMode()");

    mDirection = DIR_NONE;
    // Do nothing here... The user has to press FWD or REV to get anything to happen.
    mShotRunning = true;
    mListener.onShotMessage(SHOT_ID, "Press Forward or Back to fly along the generated path.");
}

// Starts toward the next target location
function headToNextLocation() {
    mTargetPoint = nextLocation();
    d(`headToNextLocation(): mTargetPoint=${JSON.stringify(mTargetPoint)}`);

    if (mTargetPoint) {
        // This should affect altitude as well as lat/lng
        Vehicle.gotoPoint(mTargetPoint);
        // Do yaw
        Vehicle.setYaw(mTargetPoint.yaw);
        // TODO: Do gimbal angle too
    }
}

function getShotSpeed() {
    let speed = Math.min(mShotParams.speed || 2, maxStrafeSpeed(mShotParams.radius));
    if(isNaN(speed)) speed = 1;
    return speed;
}

function nextLocation() {
    if(mGeneratedPoints.length == 0) return null;

    let result = null;

    switch(mDirection) {
        case DIR_FWD: {
            if(mPathIndex < mGeneratedPoints.length) {
                result = mGeneratedPoints[mPathIndex++];
            }
            
            break;
        }

        case DIR_REV: {
            if(mPathIndex > 0) {
                result = mGeneratedPoints[mPathIndex--];
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

exports.init = init;
exports.getShotInfo = getShotInfo;
exports.initShotPanel = initShotPanel;
exports.onEnteredGuidedMode = onEnteredGuidedMode;
exports.onGCSMessage = onGCSMessage;
exports.start = start;
exports.stop = stop;
exports.isRunning = isRunning;
exports.onVehicleMoved = onVehicleMoved;
exports.onPanelOpened = onPanelOpened;

function doTest() {
    d(`doTest()`);
}

if(process.mainModule) {
    doTest();
}
