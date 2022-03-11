'use strict'

const SHOT_ID = "mpcc";

const DIR_NONE = 0;
const DIR_FWD = 1;
const DIR_REV = 2;

const MODE_POINTS = 1;
const MODE_RUN = 2;

// Distance between generated run points. Make this shorter for more points and smoother movement.
const RUN_POINT_DIST = 1; // m

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
let mMinTargetDistance = RUN_POINT_DIST * 2;

const mShotParams = {
    speed: 2
};

let mDirection = DIR_NONE;

// Run mode
let mRunMode = MODE_POINTS;
// Points saved by the user while building the shot
const mSavedPoints = [];
// Points generated when "Done" is clicked
const mRunPoints = [];
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

        case "mpcc_test_run": {
            doTestRun();
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

    // mSavedPoints is populated now, so fill mRunPoints
    doGenerateRunPoints();
}

function doTestRun() {
    const savedPoints = [
        { where: { lat: 38.61942391567368, lng: -94.40092639136456, alt: 10 }, heading: 0, gimbal: 0 }
        , { where: { lat: 38.61959098417756, lng: -94.40045120957413, alt: 14 }, heading: 90, gimbal: 0 }
        , { where: { lat: 38.61940535248223, lng: -94.3999285096037, alt: 11 }, heading: 45, gimbal: 0 }
        , { where: { lat: 38.619164030560654, lng: -94.4004036913948, alt: 20 }, heading: 180, gimbal: 0 }
    ];

    mSavedPoints.splice(0, mSavedPoints.length);
    for(const p of savedPoints) {
        mSavedPoints.push(p);
    }

    startShot(mShotParams);
    setRunMode(MODE_RUN);
    onEnteredGuidedMode({});
}

function addSavePoint(msg) {
    d(`addSavePoint(${JSON.stringify(msg)})`);

    if(!mVehicleLocation) return d(`No vehicle location!`);

    const heading = getVehicleHeading();
    const point = {
        where: mVehicleLocation,
        heading: heading,
        gimbal: getGimbalAngle()
    };

    mSavedPoints.push(point);
    
}

function updateRunSpeed(msg) {
    d(`updateRunSpeed()`);

    mShotParams.speed = msg.speed || 1;

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

    if (mTargetPoint) {
        Vehicle.setSpeed(getShotSpeed());
    }
}

function doGenerateRunPoints() {
    const genPoints = generateRunPoints(mSavedPoints);
    for(const point of genPoints) {
        mRunPoints.push(point);
    }

    d(`doGenerateRunPoints(): ${mRunPoints.length} points`);
}

function generateRunPoints(savedPoints) {
    if(savedPoints.length == 0) {
        d(`generateRunPoints(): No saved points`);
        return false;
    }

    const output = [];

    for(let i = 0, size = savedPoints.length; i < size; ++i) {
        const point = savedPoints[i];
        const next = savedPoints[i + 1];
        const here = point.where;
        const there = next && next.where;

        if(there) {
            // Point from here to there.
            const heading = MathUtils.getHeadingFromCoordinates(here, there);
            // How far from here to there.
            const totalDistance = MathUtils.getDistance3D(here, there);
            
            const stepCount = (totalDistance / RUN_POINT_DIST);

            // Altitude
            const altDiff = (there.alt - here.alt);
            // How much alt change in each step
            const altStep = (altDiff / stepCount);

            // Yaw
            const yawDiff = (next.heading - point.heading);
            const yawStep = (yawDiff / stepCount);

            // Gimbal
            const gimbalDiff = (next.gimbal - point.gimbal);
            const gimbalStep = (gimbalDiff / stepCount);

            // Generate a list of points between here/there at RUN_POINT_DIST.
            let startPoint = here;
            let dist = RUN_POINT_DIST;
            let currAlt = here.alt;
            let currYaw = point.heading;
            let currGimbal = point.gimbal;

            while(dist < totalDistance) {
                const pt = MathUtils.newCoordFromBearingAndDistance(startPoint, heading, RUN_POINT_DIST);
                currAlt += altStep;
                currYaw += yawStep;
                currGimbal = gimbalStep;

                const gen = {
                    lat: pt.lat,
                    lng: pt.lng,
                    alt: currAlt,
                    yaw: currYaw,
                    gimbal: currGimbal
                };

                output.push(gen);

                dist += RUN_POINT_DIST;
                startPoint = pt;
            }
        } else {
            // "here" is the last point. Everything's been filled up to here, so just make the final point in the list.
            output.push({
                lat: here.lat,
                lng: here.lng,
                alt: here.alt,
                yaw: point.heading,
                gimbal: point.gimbal
            });
        }
    }

    return output;
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
                        layout_add_points: { visibility: "visible" },
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
                        layout_add_points: { visibility: "gone" },
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
    }

    mTargetPoint = null;
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

    if(!mShotRunning) return;

    // If actually running the shot:
    if(mTargetPoint != null) {
        const distToTarget = MathUtils.getDistance2D(mVehicleLocation, mTargetPoint);
        // d(`distToTarget=${distToTarget}`);

        // This probably won't apply in MPCC, since we're moving a tiny distance at a time according to a fast timer.
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

function onPanelOpened(body) {
    d(`onPanelOpened()`);

    // TODO: It's saying this twice for some reason. FIX.
    // mListener.onShotMessage(SHOT_ID, "Fly to points and save locations by pressing Add Point at each location. Then press Done Adding Points to go to the next step.");
    mSavedPoints.splice(0, mSavedPoints.length);
    mRunPoints.splice(0, mRunPoints.length);
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
    } else {
        mListener.onShotMessage(SHOT_ID, (mDirection == DIR_NONE) ? "Paused" : "Path complete");
    }
}

function getShotSpeed() {
    let speed = mShotParams.speed || 2;
    if(isNaN(speed)) speed = 1;
    return speed;
}

function nextLocation() {
    if(mRunPoints.length == 0) return null;

    let result = null;

    switch(mDirection) {
        case DIR_FWD: {
            if(mPathIndex < mRunPoints.length) {
                result = mRunPoints[mPathIndex++];
            }
            
            break;
        }

        case DIR_REV: {
            if(mPathIndex >= mRunPoints.length) {
                --mPathIndex;
            }

            if(mPathIndex > 0) {
                result = mRunPoints[mPathIndex--];
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

    if(!MathUtils) {
        MathUtils = require("../lib/MathUtils");
    }

    const savedPoints = [
        { where: { lat: 38.61942391567368, lng: -94.40092639136456, alt: 10 }, heading: 0, gimbal: 0 }
    ,   { where: { lat: 38.61959098417756, lng: -94.40045120957413, alt: 14 }, heading: 90, gimbal: 0 }
    ,   { where: { lat: 38.61940535248223, lng: -94.3999285096037, alt: 11 }, heading: 45, gimbal: 0 }
    ,   { where: { lat: 38.619164030560654, lng: -94.4004036913948, alt: 20 }, heading: 180, gimbal: 0 }
    ];

    const genPoints = generateRunPoints(savedPoints);

    for(const p of genPoints) {
        d(`yaw=${p.yaw}`);
    }

    // d(`genPoints=${JSON.stringify(genPoints)}`);
}

if(process.mainModule == module) {
    doTest();
}
