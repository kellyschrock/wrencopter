'use strict';

const fs = require("fs");
const path = require("path");
const spawn = require("child_process").spawn;

const ATTRS = {
    id: "video",
    // Name/description
    name: "Video",
    description: "Video streaming",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: []
};

let api = null;
let mConfig = {};
let lastHeartbeatTime = 0;

function d(str) {
    ATTRS.log(ATTRS.id, str);
}

function e(str) {
    console.error(`${ATTRS.id}: ${str}`);
}

/* Return an object describing this worker. If looper is true, this module must expose a loop() export. */
function getAttributes() {
    return ATTRS;
}

function loop() { }

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    // d(`onMavlinkMessage(): ${msg.name}`);

    if(!msg) return;
    if(!msg.name) return;

    switch(msg.name) {
        case "HEARTBEAT": {
            break;
        }
    }

    // ATTRS.api.Vehicle.onMavlinkMessage(msg);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d(`onGCSMessage(): msg.id=${JSON.stringify(msg)}`);

    const result = {
        ok: true
    };

    switch(msg.id) {
        case "some_message": {
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

function onGCSConnect(input) {
    d(`GCS connected from ${input.address}`);

    runScript("on_connect", input);
}

function onGCSDisconnect(input) {
    e(`GCS at ${input.address} disconnected`);

    runScript("on_disconnect", input);
}

function runScript(name, input) {
    const file = path.join(__dirname, name);
    if (fs.existsSync(file)) {
        const child = spawn("/bin/sh", [file, input.address], { shell: true });

        child.on("error", function (err) {
            d(`Error starting ${file}: ${err}`);
        });

        child.stdout.on("data", function (data) {
            d(`stdout from ${file}: ${data}`);
        });

        child.on("close", function (code) {
            d(`${file} ended with RC ${code}`);
        });
    } else {
        d(`No on_connect script found at ${file}`);
    }
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onGCSConnect = onGCSConnect;
exports.onGCSDisconnect = onGCSDisconnect;
