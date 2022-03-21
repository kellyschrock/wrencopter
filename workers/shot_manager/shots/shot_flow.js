'use strict'

const SHOT_ID = "flow";

const MIN_SPEED = 1;
const MAX_SPEED = 12;
const TARGET_DISTANCE = 40;
const DEF_START_MSG = "Flow started.";

const TOTAL_DIST = 100; // Just a little ways
const POINT_DIST = 0.1; // m
const TARGET_SPEED = 2; // m/s

const { LocationFlow, DIR_FWD, DIR_REV, DIR_NONE } = require("../lib/LocationFlow");

let ATTRS;
let Vehicle;
let WorkerUI;
let VehicleState;
let MavlinkCommands;
let MathUtils;

// Listener for this shot.
let mListener;
let mLocationFlow;

let mVehicleLocation;
let mVehicleHeading;
let mShotRunning = false;
let mStartMessage = DEF_START_MSG;
let mVehicleSpeed = 0;

const mShotParams = {
    speed: 2
,   point_spacing: POINT_DIST
};

const VERBOSE = true;

function d(str) {
    if(VERBOSE) console.log(`shot_flow: ${str}`);
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

    let lastYaw = 0;

    mLocationFlow = new LocationFlow({
        onComplete: function() {
            d(`LocationFlow sent onComplete()`);
            Vehicle.setYaw(lastYaw);
        },

        onLocation: function(where, index, count) {
            d(`onLocation(): index=${index} count=${count}`);

            lastYaw = where.yaw;
            Vehicle.gotoPoint(where);

            // if(where.gimbal) {
            //     // TODO: Vehicle.setGimbalAngle(where.gimbal);
            // }
        }
    });

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
        case "flow_panel_closed": {
            if(mShotRunning) {
                stop();
            } else {
                d("Shot is not running");
            }

            mListener.onShotPanelClosed();
            mLocationFlow.stop();

            break;
        }

        case "flow_speed_updated": {
            mShotParams.speed = msg.speed || 1;
            mLocationFlow.setTargetSpeed(mShotParams.speed);

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "flow_shot",
                values: {
                    txt_speed: {
                        text: mShotParams.speed + " m/s"
                    }
                }
            });

            // if(mShotRunning) {
            //     Vehicle.setSpeed(getShotSpeed());
            // }

            break;
        }

        case "flow_point_spacing_updated": {
            // Range is 1 to 100, divide by 10 to get the value
            mShotParams.point_spacing = (msg.point_spacing > 0)?
                (msg.point_spacing / 10).toFixed(1): 0.1;

            mListener.sendGCSMessage({
                id: "screen_update",
                screen_id: "flight",
                panel_id: "flow_shot",
                values: {
                    txt_point_spacing: {
                        text: mShotParams.point_spacing + " m"
                    }
                }
            });

            if (mShotRunning) {
                mLocationFlow.setPointSpacing(mShotParams.point_spacing);
            }

            break;
        }

        case "flow_start_shot": {
            mListener.onShotStart();
            break;
        }

        case "flow_go_forward": {
            mListener.onShotMessage(SHOT_ID, "Forward");
            mLocationFlow.start(DIR_FWD);
            break;
        }

        case "flow_go_reverse": {
            mListener.onShotMessage(SHOT_ID, "Reverse");
            mLocationFlow.start(DIR_REV);
            break;
        }

        case "flow_go_pause": {
            mListener.onShotMessage(SHOT_ID, "Pause");
            mLocationFlow.pause();
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
    stopShot();
}

function isRunning() { 
    return mShotRunning; 
}

function generateFlowedPath() {
    const out = [];

    const here = mVehicleLocation;
    if(!here) {
        onShotError(`No vehicle location`);
        return out;
    }

    const heading = getVehicleHeading();

    for(let d = 0; d < TOTAL_DIST; d += mShotParams.point_spacing) {
        const pt = MathUtils.newCoordFromBearingAndDistance(here, heading, d);
        out.push(pt);
    }

    mListener.onShotMessage(`Generated ${out.length} points`);

    // Now do yaw
    let yawStart = 0;
    let yawEnd = 90;
    const yawStep = (yawEnd / out.length);
    for(const p of out) {
        p.yaw = yawStart;
        yawStart += yawStep;
    }

    return out;
}

// Starts the shot.
function startShot(params) {
    d(`startShot(): params=${JSON.stringify(params)}`);

    if(!params) {
        return onShotError("No shot params");
    }

    if(!mVehicleLocation) {
        // return onShotError("No vehicle position");
        // SITL CAN SUCK IT.
        mVehicleLocation = {
            lat: 38.619379,
            lng: -94.400436,
            alt: 10
        };
    }

    // const targetPoint = generateTargetPoint();
    const points = generateFlowedPath();
    if(points.length == 0) return onShotError(`Unable to generate path`);

    mLocationFlow
        .setPoints(points)
        .setPointSpacing(params.point_spacing || POINT_DIST)
        .setTargetSpeed(params.speed)
        ;

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
    mLocationFlow.stop();
    
    if(mShotRunning) {
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

    mVehicleLocation = {
        lat: where.lat, lng: where.lng, alt: where.alt, speed: where.speed
    };
}

function isValidDistance(dist) {
    return (dist > -1 && !isNaN(dist));
}

function getShotInfo() {
    return {
        // Id for this shotInfo
        id: "flow",
        // Shot name
        name: "Flow",
        description: "LocationFlow test. Trying to get the copter to fly slowly toward a point without wobbling",
    }
}

function onEnteredGuidedMode(mode) {
    d("onEnteredGuidedMode()");

    // Do nothing here... The user has to press FWD or REV to get anything to happen.
    mShotRunning = true;
    mListener.onShotMessage(SHOT_ID, mStartMessage);
    mListener.onShotMessage(SHOT_ID, "Press Forward or Back to go places.");
    // mLocationFlow.start(DIR_FWD);

    mListener.sendGCSMessage({
        id: "screen_update",
        screen_id: "flight",
        panel_id: "flow_shot",
        values: {
            layout_run: {
                visibility: "visible"
            }
        }
    });
}

function getShotSpeed() {
    return mShotParams.speed;
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

exports.onSpeedUpdated = function(groundSpeed) {
    mVehicleSpeed = groundSpeed;

    if(mShotRunning) {
        mLocationFlow.onSpeedUpdated(groundSpeed);
    }
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

function testGeneratePath() {
    d(`testGeneratePath()`);
}

if(process.mainModule == module) {
    testGeneratePath();
}
