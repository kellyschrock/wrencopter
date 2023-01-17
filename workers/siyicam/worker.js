'use strict';

const path = require("path");
const fs = require("fs");
const siyicam = require("./siyicam");

const ATTRS = {
    id: "siyicam",
    // Name/description
    name: "SIYI A8 mini",
    description: "Interface for the SIYI A8 mini cam",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GPS_RAW_INT"]
};

const MAV_MODE_FLAG_SAFETY_ARMED = 128;

let mRCChannel = 0;
let mRCMapping = [];
const camera = new siyicam.SiyiCamera();

// Listen for stuff from RC channels
const mRCListener = {
    onRCChannelsChanged: function (rc) {
    //    d(`onRCChannelsChanged(): ${JSON.stringify(rc)}`);

        // Did this happen on the channel we care about?
        const value = rc[mRCChannel.toString()];
        if(value) {
            d(`update on channel ${mRCChannel}`);
            // Find a match
            mRCMapping.map(function(item) {
                if(item.value == value) {
                    d(`found item: ${item.itemid}`);
                }
            });
        }
    }
};

function d(str) {
    if(require.main === module) {
        console.log(str);
    } else {
        ATTRS.log(ATTRS.id, str);
    }
}

function getAttributes() {
    return ATTRS;
}

function loop() { }

function onLoad() {
    d("onLoad()");

    const messages = ATTRS.api.Vehicle.getVehicleMavlinkMessages();
    ATTRS.api.Vehicle.setMavlinkSendCallback(function (msg) {
        // d("Send mavlink message: " + msg.name);
        ATTRS.sendMavlinkMessage(ATTRS.id, msg);
    });

    // If we have RCInputs, set that up
    if(ATTRS.api.RCInputs) {
        const rcMessages = ATTRS.api.RCInputs.getMavlinkMessages();

        for(const m of rcMessages) {
            messages.push(m);
        }

        ATTRS.api.RCInputs.addEventListener(mRCListener);
    }

    ATTRS.subscribeMavlinkMessages(ATTRS.id, messages);

    loadRCMapping();
}

function onEnabledChanged(enabled) {
    d(`onEnabledChanged(${enabled})`);

    // No idea why you'd disable a camera, but there you go.
    if(enabled) {
    } else {
    }
}

function loadRCMapping() {
    const file = path.join(__dirname, "rcmap.json");

    mRCMapping = [];

    if(!fs.existsSync(file)) {
        return d(`${file} not found`);
    }

    const content = fs.readFileSync(file);
    try {
        const jo = JSON.parse(content);

        mRCChannel = jo.channel || 0;
        mRCMapping = jo.items || [];

        d(`mRCChannel=${mRCChannel} mRCMapping=${JSON.stringify(mRCMapping)}`);
    } catch(ex) {
        d(`Error in rcmap.json: ${ex.message}`);
        mRCMapping = [];
    }
}

function onUnload() {
    d("onUnload()");

    stopShellProcess();
}

const mModeNameMap = {
    "plane": {
        0: "manual",
        1: "circle",
        2: "stabilize",
        3: "training",
        4: "acro",
        5: "fbwa",
        6: "fbwb",
        7: "cruise",
        8: "autotune",
        10: "auto",
        11: "rtl",
        12: "loiter",
        15: "guided"
    },
    "quad": {
        0: "stabilize",
        1: "acro",
        2: "alt_hold",
        3: "auto",
        4: "guided",
        5: "loiter",
        6: "rtl",
        7: "circle",
        9: "land",
        11: "drift",
        13: "sport",
        14: "flip",
        15: "autotune",
        16: "pos_hold",
        17: "brake",
        18: "throw",
        19: "avoid_adsb",
        20: "guided_nogps",
        21: "smart_rtl"
    },
    "rover": {
        0: "manual",
        1: "acro",
        2: "learning",
        3: "steering",
        4: "hold",
        10: "auto",
        11: "rtl",
        12: "smart_rtl",
        15: "guided",
        16: "initializing"
    }
};

const mVehicleState = {
    armed: false,
    type: -1,
    mode: -1,
    fixType: 0
};

var mSelectedItem = null;

function toTypeName(type) {
    switch(type) {
        case 1: return "plane";
        case 2: return "quad";
        case 10: return "rover";
        default: return null;
    }
}

function toModeName(type, mode) {
    const typeName = toTypeName(type);
    const item = mModeNameMap[typeName];
    return item? item["" + mode]: null; // FU Javascript for treating numbers like strings
}

function hasGpsFix() {
    return (mVehicleState.fixType >= 2);
}

function onMavlinkMessage(msg) {
    if(!msg) return;
    // d(`onMavlinkMessage(): ${msg.name}`);

    if(ATTRS.api.RCInputs) {
        ATTRS.api.RCInputs.onMavlinkMessage(msg);
    }

    // Don't need to do any of this if not on the default item
    if (!(mSelectedItem && mSelectedItem.is_default)) return;

    switch(msg.name) {
        case "GPS_RAW_INT": {
//            if(mVehicleState.fixType != msg.fix_type) {
                mVehicleState.fixType = msg.fix_type;

                // sendStateToLEDs();
//            }

            break;
        }

        case "HEARTBEAT": {
            // Ignore HB from the GCS
	        if(msg.type == 6) return;

            const vehicle_mode = msg.custom_mode;

            // If mode has changed, handle that
            if(vehicle_mode != mVehicleState.mode) {
                mVehicleState.mode = vehicle_mode;

                const mode_name = toModeName(msg.type, msg.custom_mode);
                d(`mode_name=${mode_name}`);

                if (mode_name) {
                    shellCommand({command: `mode ${mode_name}`});
                }
            }

            // If arm state has changed, handle that
            const armed = ((msg.base_mode & MAV_MODE_FLAG_SAFETY_ARMED) === MAV_MODE_FLAG_SAFETY_ARMED);
            if(armed != mVehicleState.armed) {
                mVehicleState.armed = armed;
                shellCommand({command: (armed) ? "arm" : "disarm"});

                // After arming, wait 10s and then go back to displaying mode.
                // The next HB message will cause the mode to get set and switch the LEDs.
                if(mVehicleState.armed) {
                    setTimeout(function () {
                        mVehicleState.mode = -1;
                    }, 9000); // Yes, 9s -- HB is at ~1s interval
                }
            }
            break;
        }
    }
}

function onGCSMessage(msg) {
    d(`onGCSMessage(): msg=${JSON.stringify(msg)}`);

    const result = {
        ok: true
    };

    switch(msg.id) {
        case "zoom_in": { camera.zoomIn(); break; }
        case "zoom_out": { camera.zoomOut(); break; }
        case "zoom_stop": { camera.zoomStop(); break; }
        case "manual_focus_in": { camera.manualFocusIn(); break; }
        case "manual_focus_out": { camera.manualFocusOut(); break; }
        case "auto_center": { camera.autoCenter(); break; }

        case "gimbal_yaw": {
            camera.gimbalYaw(parseInt(msg.yaw), parseInt(msg.speed || 10));
            break;
        }

        case "gimbal_pitch": {
            camera.gimbalPitch(parseInt(msg.pitch), parseInt(msg.speed || 10));
            break;
        }

        case "take_picture": {
            camera.takePicture();
            break;
        }

        case "toggle_record": {
            camera.toggleVideoRecord();
            break;
        }

        case "motion_lock": {
            camera.motionLock();
            break;
        }

        case "motion_follow": {
            camera.motionFollow();
            break;
        }

        case "motion_fpv": {
            camera.motionFPV();
            break;
        }

        default: {
            result.ok = false;
            result.message = `Unknown command ${msg.id}`;
            break;
        }
    }

    return result;
}

// function onBroadcastRequest(msg) {
//     switch(msg.type) {
//         case "mission_item_support": {
//             return {
//                 id: ATTRS.id,
//                 name: ATTRS.name,
//                 actions: [
//                     { 
//                         id: "led_mode",     // action id
//                         name: "LED mode",   // action text for UI
//                         msg_id: "led_mode", // message_id
//                         params: [
//                             {
//                                 id: "mode", 
//                                 name: "Mode", 
//                                 type: "enum", 
//                                 values: getLEDParamValues(), 
//                                 default: "red" 
//                             }
//                         ]
//                     }
//                 ]
//             }
//         }

//         default: {
//             return null;
//         }
//     }
// }

function sendScreenUpdates() {
    if(!mSelectedItem) return;

    ATTRS.sendGCSMessage(ATTRS.id, {
        id: "screen_update",
        screen_id: "commands",
        panel_id: "worker_flight_buttons",
        values: {
            txt_led_name: { text: mSelectedItem.text }
        }
    });
}

function sendContentDialogMsg() {
    if(!mMenuItems) {
        return d(`No menu items to display`);
    }

    const items = [];

    if(mMenuItems["default"]) {
        const defItem = mMenuItems["default"];
        items.push({id: "default", text: "Default", msg_id: "run_led" });
    }

    for(let prop in mMenuItems) {
        if(prop === "default") continue;

        const item = mMenuItems[prop];
        items.push({id: item.id, text: item.text, msg_id: "run_led" });
    }

    // d(`items=${JSON.stringify(items)}`);

    ATTRS.sendGCSMessage(ATTRS.id, {
        id: "content_dialog",
        dialog_id: "dlg_content_download",
        title: "Select LEDs",
        text: "Pick an LED mode.",
        list_items: items
    });
}

function onScreenEnter(screen) {
    switch (screen) {
        // TODO: This is wrong. Should go on the camera panel.
        case ATTRS.api.WorkerUI.Const.SCREEN_COMMANDS: {
            const body = ATTRS.api.WorkerUI.loadLayout(__dirname, ATTRS.api.WorkerUI.Const.PANEL_WORKER_FLIGHT_BUTTONS);

            if (body) {
                // d(JSON.stringify(body));

                setTimeout(function() {
                    sendScreenUpdates();
                }, 1000);

                return {
                    screen_id: screen,
                    worker_flight_buttons: body
                };
            } else {
                return null;
            }
            break;
        }

        default: {
            return null;
        }
    }
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onScreenEnter = onScreenEnter;
exports.onEnabledChanged = onEnabledChanged;
// exports.onBroadcastRequest = onBroadcastRequest;

function testModeNames() {
    // d(JSON.stringify(mModeNameMap));

    const types = [1, 2, 10];
    types.map(function(type) {
        d(toTypeName(type));

        for (let i = 0; i < 20; ++i) {
            const modeName = toModeName(type, i);
            if(modeName) {
                d(`\t${modeName}`);
            }
        }
    });
}

if(require.main === module) {
    // onLoad();
    // sendContentDialogMsg();
    testModeNames();
}

