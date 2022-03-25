'use strict';

const spawn = require("child_process").spawn;
const path = require("path");
const fs = require("fs");

const ATTRS = {
    id: "gimbal",
    // Name/description
    name: "Gimbal",
    description: "Controls gimbal and keeps it level",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: ["ATTITUDE"]
};

const ATTI_HANDLE_INTERVAL = 100;

let mLastAtti = 0;
var mChildProcess = null;

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

    ATTRS.subscribeMavlinkMessages(ATTRS.id, messages);
}

function onEnabledChanged(enabled) {
    d(`onEnabledChanged(${enabled})`);

    if(enabled) {
        setTimeout(function () {
            startShellProcess();
        }, 100);
    } else {
        stopShellProcess();
    }
}

function onUnload() {
    d("onUnload()");

    stopShellProcess();
}

function processAttitude(msg) {
    return {
        roll: Math.toDegrees(msg.roll),
        rollSpeed: Math.toDegrees(msg.rollspeed),
        pitch: Math.toDegrees(msg.pitch),
        pitchSpeed: Math.toDegrees(msg.pitchspeed),
        yaw: Math.toDegrees(msg.yaw),
        heading: yawToHeading(Math.toDegrees(msg.yaw)),
        yawSpeed: Math.toDegrees(msg.yawspeed)
    };
}

function onMavlinkMessage(msg) {
    if(!msg) return;
    // d(`onMavlinkMessage(): ${msg.name}`);

    switch(msg.name) {
        case "ATTITUDE": {
            const now = Date.now();
            if((now - mLastAtti) > ATTI_HANDLE_INTERVAL) {
                const atti = processAttitude(msg);
                sendAngleCommands(atti);
                mLastAtti = now;
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
        case "do_pitch": {
            processUserPitch(msg);
            break;
        }
    }

    return result;
}

function processUserPitch(msg) {
    // msg.pitch will have the user-requested gimbal angle. 
    // Set an offset to use when compensating for attitude pitch
    mPitchOffset = msg.pitch;
}

function startShellProcess() {
    d(`startShellProcess()`);

    if(mChildProcess) {
        return {ok: false, message: "Child process is already running"};
    }

    // Uncomment this when testing
    // return {ok: true};

    const server = path.join(__dirname, "gimbal_control.py");
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

        // TODO: Get roll/pitch values from here by sending "get roll" or "get pitch" to the child process
    });

    child.stderr.on("data", function(data) {
        const str = data.toString("utf-8");
        d(`child.stderr: ${str}`);
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

    shellCommand({command: "quit"});

    return { ok: true, message: "stopped" };
}

function sendAngleCommands(atti) {
    const roll = -atti.roll;
    const pitch = -atti.pitch + mPitchOffset;

    const cmd = `set roll=${roll} pitch=${pitch}`;

    shellCommand(cmd);
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

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onEnabledChanged = onEnabledChanged;

(function () {
    if (!Math.toRadians) {
        Math.toRadians = function (degrees) {
            return degrees * Math.PI / 180;
        }
    }

    if (!Math.toDegrees) {
        Math.toDegrees = function (radians) {
            return radians * 180 / Math.PI;
        }
    }
})();

