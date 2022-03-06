'use strict';

const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");

const ATTRS = {
    id: "subscriber",
    // Name/description
    name: "WS subscriber",
    description: "Testing VehicleTopics subscriber",
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
    api = ATTRS.api;


    const host = `ws://192.168.5.36:3000`;
    try {
        const socket = new WebSocket(host);

        socket.on("open", function open() {
            d(`Opened socket`);
        });

        socket.on("error", function err(ex) {
            e(`Socket error: ${ex.message}`);
        });

        socket.on("message", function incoming(msg) {
            d(`Message from websocket: ${msg}`);
        });

        setTimeout(() => {
            socket.send(JSON.stringify({
                type: "subscribe-topic",
                topic: "location"
            }));

            socket.send(JSON.stringify({
                type: "subscribe-topic",
                topic: "attitude"
            }));
        }, 5000);

        setTimeout(() => {
            socket.send(JSON.stringify({
                type: "unsubscribe-topic",
                topic: "location"
            }));
            socket.send(JSON.stringify({
                type: "unsubscribe-topic",
                topic: "attitude"
            }));

            setTimeout(() => {
                d(`Close the websocket`);
                socket.close();
            }, 3000);
        }, 15000);

    } catch(ex) {
        e(`Error connecting to ${host}: ${ex.message}`);
    }
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
            sendCameraHeartbeat(msg.header.srcSystem);
            break;
        }

        case "COMMAND_LONG": {
            switch(msg.command) {
                case ATTRS.api.Mavlink.MAV_CMD_DO_DIGICAM_CONTROL: {
                    if(msg.param5 == 1) {
                        camera.takePicture(function(err) {
                            if(err) {
                                sendCameraError(err.message || err);
                            } else {
                                d(`Took picture`);
                            }
                        });
                    }
                    break;
                }
            }
            break;
        }

        // This is useful.
        // case "CAMERA_FEEDBACK": {
        //     d(JSON.stringify(msg));
        //     break;
        // }
    }

    ATTRS.api.Vehicle.onMavlinkMessage(msg);
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

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
