'use strict';

const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");
const follow_algo = require("./FollowAlgo");
const { FollowAlgo } = follow_algo;

const ATTRS = {
    id: "follow_other",
    // Name/description
    name: "Follow other vehicle",
    description: "Follows another vehicle in different ways",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: []
};

let api = null;
let mConfig = {};
let mSocket = null;
let lastHeartbeatTime = 0;

const mState = {
    flying: false,
    guided_mode: false,
    target_params: {}
}

function d(str) {
    ATTRS.log(ATTRS.id, str);
}

function e(str) {
    console.error(`${ATTRS.id}: ${str}`);
}

const mVehicleEventListener = {
    onDroneEvent: function(event, extras) {
        switch(event) {
            case ATTRS.api.Vehicle.Events.LOCATION_UPDATED: {
                mState.my_location = extras;
                break;
            }

            case ATTRS.api.Vehicle.Events.FLYING_UPDATED: {
                const flying = (extras && extras.flying) || false;

                if(flying != mState.flying) {
                    if(flying) {
                        // started flying
                    } else {
                        // stopped flying, armed.
                        stopFollowing();
                    }

                    mState.flying = flying;
                }

                break;
            }

            case ATTRS.api.Vehicle.Events.ARM_UPDATED: {
                const armed = (extras && extras.armed) || false;

                if(armed != mState.armed) {
                    if(armed) {
                        // armed
                    } else {
                        // disarmed, abort
                        stopFollowing();
                    }

                    mState.armed = armed;
                }
                break;
            }

            case ATTRS.api.Vehicle.Events.MODE_UPDATED: {
                const state = ATTRS.api.Vehicle.getState();
                const newMode = extras.mode;
                const guidedMode = ATTRS.api.VehicleState.getGuidedModeFor(state.vehicleType);

                const isGuided = (newMode.number === guidedMode.number);
                if(mState.guided_mode != isGuided) {
                    if (isGuided) {
                        d(`This vehicle entered guided mode`);
                        // We just entered guided mode
                    } else {
                        // Just left guided mode
                        d(`This vehicle left guided mode`);
                        if(mState.flying) {
                            stopFollowing();
                        }
                    }

                    mState.guided_mode = isGuided;
                }

                break;
            }

            case ATTRS.api.Vehicle.Events.FAILSAFE: {
                // STOP EVERYTHING.
                stopFollowing();
                break;
            }
        }  
    }
};

/* Return an object describing this worker. If looper is true, this module must expose a loop() export. */
function getAttributes() {
    return ATTRS;
}

function loop() { }

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");
    api = ATTRS.api;
    follow_algo.setAPI(api);

    const messages = ATTRS.api.Vehicle.getVehicleMavlinkMessages()
        .concat(ATTRS.api.RCInputs.getMavlinkMessages());

    ATTRS.api.Vehicle.setIds(ATTRS.sysid, ATTRS.compid);
    ATTRS.api.Vehicle.setMavlinkSendCallback(function (msg) {
        // d("Send mavlink message: " + msg.name);
        ATTRS.sendMavlinkMessage(ATTRS.id, msg);
    });

    ATTRS.api.Vehicle.addEventListener(mVehicleEventListener);
    ATTRS.subscribeMavlinkMessages(ATTRS.id, messages);

    // Just a test, REMOVE THIS
    // connectToVehicle({
    //     address: "192.168.5.36",
    //     port: 3000,
    //     type: "behind",
    //     look: true,
    //     distance: 8
    // });

    // setTimeout(() => {
    //     stopFollowing();
    // }, 15000);
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    ATTRS.api.Vehicle.onMavlinkMessage(msg);
    // ATTRS.api.RCInputs.onMavlinkMessage(msg);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d(`onGCSMessage(): msg.id=${JSON.stringify(msg)}`);

    const result = {
        ok: true
    };

    switch(msg.id) {
        case "follow": {
            result.ok = followVehicle(msg);
            break;
        }

        case "stop": {
            stopFollowing(msg);
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

function followVehicle(params) {
    d(`followVehicle(${JSON.stringify(params)})`);
    
    if(!params) return false;
    if(!params.address) { e(`No params.address`); return false; }

    if(mSocket) {
        d(`Already connected/following`);
        stopFollowing();
    }

    mState.target_params = Object.assign({}, params);

    if(!params.type) params.type = "behind";
    const port = params.port || 80;
    let followDistance = params.distance || 5;
    // Don't get closer than 5 meters until this is well tested.
    if(followDistance < 5) followDistance = 5;

    const host = `ws://${params.address}:${port}`;
    try {
        const socket = new WebSocket(host);

        socket.on("open", function open() {
            d(`Opened socket`);
        });

        socket.on("error", function err(ex) {
            e(`Socket error: ${ex.message}`);
        });

        socket.on("message", (input) => {
            d(`Message from websocket: ${input}`);

            if(input == "\"connected\"") {
                const algo = FollowAlgo.forOptions(params);
                if(!algo) {
                    e(`No follow algorithm for params ${JSON.stringify(params)}`);
                    stopFollowing();
                } else {
                    d(`Using ${algo.constructor.name} for ${JSON.stringify(params)}`);
                    mState.follow_algo = algo;
                }
            } else {
                onIncoming(JSON.parse(input));
            }
        });

        mSocket = socket;

        // Subscribe to the relevant topics
        setTimeout(() => {
            ["location", "mission"].forEach((topic) => {
                socket.send(JSON.stringify({
                    type: "subscribe-topic",
                    topic: topic
                }));
            });
        }, 1000);
    } catch (ex) {
        e(`Error connecting to ${host}: ${ex.message}`);
    }
}

function disconnectTargetVehicle() {
    if(mSocket) {
        // Unsubscribe from the topics we asked for earlier.
        ["location"].forEach((topic) => {
            mSocket.send(JSON.stringify({
                type: "unsubscribe-topic",
                topic: topic
            }));
        });

        try {
            mSocket.close();
        } catch(ex) {
            e(`Error closing socket: ${ex.message}`);
                setTimeout(() => {
            ["location"].forEach((topic) => {
                socket.send(JSON.stringify({
                    type: "subscribe-topic",
                    topic: topic
                }));
            });
        }, 1000);
}

        mSocket = null;
        mState.target_params = {};
    }
}

function stopFollowing() {
    disconnectTargetVehicle();
    if(mState.follow_algo && mState.follow_algo.stop) {
        mState.follow_algo.stop();
    }

    mState.follow_algo = null;
}

function onIncoming(msg) {
    d(`onIncoming(${JSON.stringify(msg)})`);
    
    if(!msg) return;
    if(msg.event != "topic") return;

    switch(msg.topic) {
        case "location": {
            // If msg.sender.address doesn't match mState.target_params.address,
            // ignore it. Otherwise we could be trying to follow 2+ vehicles at a time.
            if(mState.target_params && msg.sender && (mState.target_params.address == msg.sender.address)) {
                onTargetMoved(msg.message);
            }
            break;
        }
    }
}

function onTargetMoved(where) {
    if(!mState.guided_mode) return;
    d(`onTargetMoved(): ${JSON.stringify(where)}`);

    mState.target_location = where;

    if(mState.my_location && mState.flying && mState.guided_mode) {
        if(mState.follow_algo && mState.follow_algo.processLocation) {
            mState.follow_algo.processLocation(mState.my_location, mState.target_location);
        } else {
            e(`Error handling target location: follow_algo=${mState.follow_algo}`);
            stopFollowing();
        }
    }
}

exports.onIVCPeerAdded = (peer) => {
    d(`Added IVC peer at ${JSON.stringify(peer)}`);

    // followVehicle(peer);
}

exports.onIVCPeerDropped = (peer) => {
    d(`Peer at ${peer.address} dropped`);

    if(peer && mState.target_params && peer.address == mState.target_params.address) {
        d(`Stop following`);
        stopFollowing();
    }
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
