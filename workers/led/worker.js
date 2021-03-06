'use strict';

const spawn = require("child_process").spawn;
const path = require("path");
const fs = require("fs");

const ATTRS = {
    id: "leds",
    // Name/description
    name: "LEDs",
    description: "Uses rpi_281x lib to control LEDs via Python scripts",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GPS_RAW_INT"]
};

const MAV_MODE_FLAG_SAFETY_ARMED = 128;

var mRCChannel = 0;
var mRCMapping = [];
var mMenuItems = {};
var mChildProcess = null;

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
                    selectMenuItem(item.itemid);
                }
            });
        }
    }
};

function d(str) {
    if(process.mainModule === module) {
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

    loadMenuItems();
    loadRCMapping();
}

function onEnabledChanged(enabled) {
    d(`onEnabledChanged(${enabled})`);

    if(enabled) {
        setTimeout(function () {
            startShellProcess();
        }, 1000);

        setTimeout(function () {
            sendStateToLEDs();
        }, 3000);
    } else {
        stopShellProcess();
    }
}

function selectMenuItem(id) {
    const item = mMenuItems[id];

    d(`selectMenuItem(${id}): item=${JSON.stringify(item)}`);

    if(item) {
        mSelectedItem = item;
        sendScreenUpdates();
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

function loadMenuItems() {
    const file = path.join(__dirname, "leds.json");

    mMenuItems = {};

    if(!fs.existsSync(file)) {
        return d(`${file} not found`);
    }

    const content = fs.readFileSync(file);
    try {
        const jo = JSON.parse(content);

        mMenuItems = jo;
        mSelectedItem = mMenuItems["default"];
    } catch(ex) {
        mMenuItems = {};
        mSelectedItem = null;

        return d(`Error loading ${file}: ${ex.message}`);
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

function fixStateName() {
    return (hasGpsFix())? "fix": "nofix";
}

function armStateName() {
    return (mVehicleState.armed)? "armed": "disarmed"
}

function sendStateToLEDs() {
    const str = `state ${armStateName()} ${fixStateName()}`;
    shellCommand({command: str});
}

function sendModeToLEDs(mode) {
    if (!mChildProcess) {
        return d("No child process");
    }

    mChildProcess.stdin.write(`mode ${mode.toLowerCase()}\n`);
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
        // Display config dialog
        case "config_dialog": {
            sendContentDialogMsg();
            break;
        }

        // Run a script
        case "run_led": {
            return runLed(msg);
        }

		case "list_modes": {
			return listModes(msg);
		}

		case "led_command": {
			return doLEDCommand(msg);
		}
    }

    return result;
}

function doLEDCommand(msg) {
	const result = { ok: true };

	if(msg.command) {
		shellCommand({ command: msg.command });
	} else {
		result.ok = false;
		result.message = "No LED command specified";
	}

	return result;
}

function listModes(msg) {
	const result = {
		ok: true
	};

	let output = "\n";

	Object.keys(mMenuItems).forEach((key) => {
		const item = mMenuItems[key];
		if(item) {
			output += `${item.id}\t${item.text}\n`;
		}
	});

	result.output = output;

	return result;
}

function runLed(msg) {
    d(`runLed(): ${JSON.stringify(msg)}`);
    const result = {
        ok: true
    };

    // d(`mMenuItems=${JSON.stringify(mMenuItems)}`);

    const item = mMenuItems[msg.item_id];
    d(`item=${JSON.stringify(item)}`);

    if(!item) {
        result.ok = false;
        result.message = `No item found with name ${msg.item_id}`;
        return result;
    }

    if(item.command) {
        shellCommand(item);
    }

    mSelectedItem = item;

    if(item.is_default) {
        // Reset the LEDs.
        shellCommand({command: "all_off"});

        // Reset state so the next heartbeat message updates the LEDs.
        mVehicleState.mode = -1;
        mVehicleState.type = -1;
    }

    sendScreenUpdates();

    return result;
}

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

function startShellProcess() {
    d(`startShellProcess()`);

    if(mChildProcess) {
        return {ok: false, message: "Child process is already running"};
    }

    // Uncomment this when testing
    // return {ok: true};

    const dir = path.join(__dirname, "script");
    const server = path.join(dir, "default.py");
    d(`server=${server}`);

    const child = spawn("python3", [ server ], { shell: true });
    child.stdin.setEncoding("utf-8");
    d(`child=${child}`);

    child.on("error", function (error) {
        d(`Error starting child process: ${error}`);
    });

    child.stdout.on("data", function(data) {
        const str = data.toString("utf-8");
        d(`child.stdout: ${str}`);

        // Speak output from the shell process.
        if(str.startsWith("speak: ")) {
            ATTRS.sendGCSMessage(ATTRS.id, {
                id: "speech",
                text: str.substring(6)
            });
        }
    });

    child.stderr.on("data", function(data) {
        const str = data.toString("utf-8");
        d(`child.stderr: ${str}`);

        // Speak output from the shell process.
        if(str.startsWith("speak: ")) {
            ATTRS.sendGCSMessage(ATTRS.id, {
                id: "speech",
                text: str.substring(6)
            });
        }
    });

    child.on("close", function(code) {
        d(`Child closed with ${code}`);
        mChildProcess = null;
    });

    mChildProcess = child;

    return { ok: true };
}

function stopShellProcess() {
    d(`stopShellProcess()`);

    if(!mChildProcess) {
        d(`Child process is not running`);
        return { ok: false, message: "Child process is not running" };
    }

    // ATTRS.sendGCSMessage(ATTRS.id, {
    //     id: "screen_update",
    //     screen_id: "commands",
    //     panel_id: "worker_flight_buttons",
    //     values: {
    //         btn_stop_shell: { enabled: false },
    //         btn_start_shell: { enabled: true }
    //     }
    // });

    shellCommand({command: "quit"});

    return { ok: true, message: "stopped" };
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

function shellCommand(msg) {
    d(`shellCommand(${JSON.stringify(msg)})`);

    if(!mChildProcess) {
	d("No child process");
        return { ok: false, message: "Child process is not running" };
    }

    if(!msg.command) {
        return { ok: false, message: "Missing command" };
    }

    d(`Send command ${msg.command}`);
    mChildProcess.stdin.write(`${msg.command}\n`);

    return { ok: true, message: "sent" };
}

function onScreenEnter(screen) {
    switch (screen) {
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

if(process.mainModule === module) {
    // onLoad();
    // sendContentDialogMsg();
    testModeNames();
}

