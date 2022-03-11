'use strict';

const 
    fs = require("fs")
,   path = require("path")
;

const ATTRS = {
    id: "shot_manager",
    // Name/description
    name: "Shot Manager",
    description: "Smart Shots",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: []
};

const mRCListener = {
    onRCChannelsChanged: function(rc) {
        console.log(`onRCChannelsChanged(): ${JSON.stringify(rc)}`);
    }
};

let mVehicleLocation = null;

const mVehicleEventListener = {
    onDroneEvent: function (event, extras) {
        // d(`onDroneEvent(${event}, ${JSON.stringify(extras)})`);

        switch (event) {
            case ATTRS.api.Vehicle.Events.LOCATION_UPDATED: {
                // d(`Location updated: ${JSON.stringify(extras)}`);

                mVehicleLocation = extras;

                const shot = mSelectedShot;
                if (!shot) return;

                if(shot.onVehicleMoved) shot.onVehicleMoved(extras);
                break;
            }

            case ATTRS.api.Vehicle.Events.MODE_UPDATED: {
                d(`Mode updated: ${JSON.stringify(extras)}`);

                const shot = mSelectedShot;
                if (!shot) return;

                // If switching out of Guided mode, end the shot.
                const state = ATTRS.api.Vehicle.getState();
                const newMode = extras.mode;
                const guidedMode = ATTRS.api.VehicleState.getGuidedModeFor(state.vehicleType);

                // We just switched to Guided mode
                if (newMode.number === guidedMode.number) {
                    if(shot.onEnteredGuidedMode) {
                        if(!mShotRunning) {
                            // Only start the shot ONCE.
                            shot.onEnteredGuidedMode(newMode);
                        }
                    }
                } else {
                    // Shot has ended from switching out of Guided mode.
                    shot.stop();
                }

                break;
            }

            case ATTRS.api.Vehicle.Events.FAILSAFE: {
                d("FAILSAFE EVENT");
                say("Failsafe, stop everything");

                shot.stop();
                break;
            }
        }
    }
};

const mShotListener = {
    onShotPanelClosed: function(shotId) {
        mSelectedShot = null;
    },

    // Shot wants to start
    onShotStart: function(shotId) {
        mSelectedShot.start();
    },

    // Shot is ready to start. Put the vehicle in guided mode.
    onShotStartReady: function(shotId) {
        const state = ATTRS.api.Vehicle.getState();
        if(state) {
            const guidedMode = ATTRS.api.VehicleState.getGuidedModeFor(state.vehicleType);
            const myMode = state.mode;

            // If not in Guided, switch to it. Otherwise, tell the shot we've entered guided mode
            if(myMode.number !== guidedMode.number) {
                ATTRS.api.Vehicle.setMode(guidedMode);
            } else {
                if(mSelectedShot.onEnteredGuidedMode) {
                    mSelectedShot.onEnteredGuidedMode();
                }
            }
        } else {
            d("Error: No vehicle state");
            say("No vehicle state, not ready");
        }
    },

    // Shot has started
    onShotStarted: function(shotId) {
        say(`Shot ${shotId} started`);

        d(`onShotStarted(${shotId})`);
        mShotRunning = true;
        // The shot more or less takes over for a while. Vehicle messages are forwarded to the shot.
    },

    // Shot has completed
    onShotComplete: function(shotId) {
        d(`onShotComplete(${shotId})`);
        if(mSelectedShot && mSelectedShot.info) say(`Shot ${mSelectedShot.info.name} complete`);

        setHandsOffMode();
        mShotRunning = false;
        mSelectedShot = null;

        // Close the shot UI and go back to the selector screen
        setTimeout(function () { 
            sendShotsPanelScreen(); 
        }, 1000);
    },

    // Shot has stopped
    onShotStopped: function(shotId) {
        say(`Shot ${shotId} stopped`);

        d(`onShotStopped(${shotId})`);

        setHandsOffMode();
        sendCloseFullscreenMsg();
        mShotRunning = false;
        mSelectedShot = null;
    },

    // Shot has crapped out
    onShotError: function(shotId, err) {
        d(`error in ${shotId}: ${err.message}`);
        say(`error in ${shotId}: ${err.message}`);

        setHandsOffMode();
    },

    // Shot wants to send a GCS message
    sendGCSMessage(msg) {
        ATTRS.sendGCSMessage(ATTRS.id, msg);
    },

    onShotMessage: function(shotId, str) {
        d(`onShotMessage(): ${shotId}: ${str}`);
        say(str);
    },

    onSendScreen: function(shotId, pathname) {
        d(`onSendScreen(${shotId}, ${pathname})`);
    }
};

// Switch out of Guided mode to hands-off mode (varies with vehicle)
function setHandsOffMode() {
    const state = ATTRS.api.Vehicle.getState();
    if (state) {
        const guidedMode = ATTRS.api.VehicleState.getGuidedModeFor(state.vehicleType);
        const myMode = state.mode;
        if(guidedMode.number == myMode.number) {
            ATTRS.api.Vehicle.setMode(ATTRS.api.VehicleState.getPauseModeFor(state.vehicleType));
        }
    } else {
        say("No vehicle state");
    }
}

const mShots = {};
var mSelectedShot = null;
var mShotRunning = false;

function d(str) {
    ATTRS.log(ATTRS.id, str);
}

/*
Return an object describing this worker. If looper is true, this module must expose a loop() export.
*/
function getAttributes() {
    return ATTRS;
}

// Called from dispatch.loop()
function loop() { }

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");

    // Update the mavlink messages we're interested in.
    // Note that we can't do it in ATTRS above, since Vehicle isn't loaded into this module
    // at that point. It has to be done after the worker is loaded (and injected with the Vehicle dependency).
    const messages = ATTRS.api.Vehicle.getVehicleMavlinkMessages()
        .concat(ATTRS.api.RCInputs.getMavlinkMessages());

    ATTRS.api.Vehicle.setIds(ATTRS.sysid, ATTRS.compid);
    ATTRS.api.Vehicle.setMavlinkSendCallback(function (msg) {
        // d("Send mavlink message: " + msg.name);
        ATTRS.sendMavlinkMessage(ATTRS.id, msg);
    });

    ATTRS.api.Vehicle.addEventListener(mVehicleEventListener);

    ATTRS.api.RCInputs.addEventListener(mRCListener);

    ATTRS.subscribeMavlinkMessages(ATTRS.id, messages);

    gatherShotInfo();
}

// Called when unloading
function onUnload() {
    // d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    ATTRS.api.Vehicle.onMavlinkMessage(msg);
    ATTRS.api.RCInputs.onMavlinkMessage(msg);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d(`onGCSMessage(): msg=${JSON.stringify(msg)}`);

    const result = {
        ok: true
    };

    switch(msg.id) {
        // Open the shots panel:
        case "open_shots_panel": {
            sendShotsPanelScreen();
            break;
        }

        case "shot_item_selected": {
            // Update the description to show what's selected.
            ATTRS.sendGCSMessage(ATTRS.id, {
                id: "screen_update",
                screen_id: "flight",
                panel_id: "shots_panel",
                values: {
                    txt_shot_description: { text: msg.selected_shot.subtitle }
                }
            });

            break;
        }

        // User selected a shot.
        // Display the UI for this shot on the screen.
        case "shot_selected": {
            openShotUI(msg);
            break;
        }

        // TODO: Need something to launch the shot.

        // Shots panel was closed
        case "shots_panel_closed": {
            break;
        }

        default: {
            // Pass the unknown message to the shot to see if it knows what to do with it.
            result.ok = false;
            result.message = `No message with id ${msg.id}`;

            if(mSelectedShot && mSelectedShot.onGCSMessage) {
                const out = mSelectedShot.onGCSMessage(msg);
                d(`out=${JSON.stringify(out)}`);
                if(out) {
                    result.ok = out.ok;
                    result.message = out.message;
                } else {
                    result.ok = true; // shrug!
                }
            }

            break;
        }
    }

    return result;
}

function openShotUI(msg) {
    const selectedShot = msg.selected_shot || null;
    const shotId = (selectedShot)? selectedShot.id: null;
    const shot = (shotId)? mShots[shotId]: null;

    d(`openShotUI(): ${JSON.stringify(shot.info)}`);
    // say("open shot U I");

    // If there's already a selected shot, stop it.
    if(mSelectedShot) {
        // say("Shot is already active, stopping that one");

        d(`Stop shot ${mSelectedShot.info.id}`);

        if(mSelectedShot.stop) {
            mSelectedShot.stop();
        }
    }

    mSelectedShot = shot;

    if(!shot) {
        return d(`No shot for ${shot.id}`);
    }

    if(mVehicleLocation && mSelectedShot.onVehicleMoved) {
        mSelectedShot.onVehicleMoved(mVehicleLocation);
    }

    // for(let prop in mSelectedShot) {
    //     d(`shot[${prop}]=${shot[prop]}`);
    // }

    // say(`Load layout for ${shotId}`);
    let body = loadLayoutFor(`shot/${shotId}/shot_panel`);
    if(body) {
        if(shot.initShotPanel) {
            body = shot.initShotPanel(body);
        }

        if(shot.onPanelOpened) {
            shot.onPanelOpened(body);
        }

        // say("Send full screen message");
        ATTRS.sendGCSMessage(ATTRS.id, { id: "display_fullscreen", content: body });
    } else {
        say("No body found for shot");
    }
}

function sendShotsPanelScreen() {
    const body = loadLayoutFor("shots_panel");

    if (body) {
        // Fill the shots list with the show info gathered elsewhere. 
        // Populate the RecyclerView with the shot info.
        // Make it so you can select an item in the left-hand RecyclerView, and it will
        // update the screen to show the description on the right-hand side.
        // If that's too much of a pain in the ass, just show title and description in 
        // each item (assuming that's possible).
        const rv = ATTRS.api.WorkerUI.findViewById(body.layout, "rv_selected_shot", true);

        if(rv) {
            const items = [];

            for(let prop in mShots) {
                const shot = mShots[prop].info;
                items.push({
                    id: shot.id, title: shot.name, subtitle: shot.description
                });
            }

            rv.adapter.items = items;
        }

        ATTRS.sendGCSMessage(ATTRS.id, { id: "display_fullscreen", content: body } );
    }
}

//
// Return a UI for the specified screen.
//
function onScreenEnter(screen) {
    switch(screen) {
        case ATTRS.api.WorkerUI.Const.SCREEN_FLIGHT: {
            const body = loadLayoutFor(ATTRS.api.WorkerUI.Const.PANEL_WORKER_SHOT_BUTTONS);

            if(body) {
                return {
                    screen_id: screen,
                    worker_shot_buttons: body
                };
            } else {
                return null;
            }
        }
    }
}

function onScreenExit(screen) {

}

function loadLayoutFor(panel) {
    return ATTRS.api.WorkerUI.loadLayout(__dirname, panel);
}

// Serve an image if it exists.
function onImageDownload(name) {
    return ATTRS.api.WorkerUI.serveImage(__dirname, name);
}

function gatherShotInfo() {
    d("gatherShotInfo()");

    // Iterate through all the files in the shots directory and 
    // require() them as modules.
    const dir = getShotsDir();
    fs.readdirSync(dir).map((file) => {
        if(file.startsWith("shot_") && file.endsWith(".js")) {
            const shot = loadShot(path.join(dir, file));
            if(shot) {
                const info = shot.info;
                if(info) {
                    mShots[info.id] = shot;
                }
            }
        }
    });

    // d(`shots=${JSON.stringify(mShots)}`);
}

function loadShot(filename) {
    d(`loadShot(): ${filename}`);

    const shot = require(filename);
    const info = (shot.getShotInfo)? shot.getShotInfo(): null;

    if(info) {
        info.path = filename;
        shot.init(ATTRS, mShotListener);
        shot.info = info;
    }

    return shot;
}

function getShotsDir() {
    return path.join(__dirname, "shots");
}

function sendCloseFullscreenMsg() {
    ATTRS.sendGCSMessage(ATTRS.id, {
        id: "hide_fullscreen",
        screen_id: "flight",
        panel_id: "shots_panel",
        values: { }
    });
}

function onBroadcastResponse(msg) {
    d(`onBroadcastResponse()`);

    // if(msg.response) {
    //     switch(msg.request.type) {
    //         case "shot_info": {
    //             const shotInfo = msg.response;
    //             if(shotInfo) {
    //                 if(mShotInfo) {
    //                     mShotInfo.push(shotInfo);
    //                 } else {
    //                     mShotInfo = [shotInfo];
    //                 }
    //             }

    //             break;
    //         }
    //     }
    // }
}

function say(str) {
    ATTRS.api.WorkerUI.sendSpeechMessage(ATTRS, str, ATTRS.api.WorkerUI.SpeechType.TTS);
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onScreenEnter = onScreenEnter;
exports.onScreenExit = onScreenExit;
exports.onImageDownload = onImageDownload;
exports.onBroadcastResponse = onBroadcastResponse;

exports.testShot = function(id, state) {
    mSelectedShot = mShots[id];

    if(mSelectedShot) {
        if(mSelectedShot.test) {
            mSelectedShot.test(state);
        } else {
            d(`no test() function in shot ${id}`);
        }
    } else {
        d(`no shot with id ${id}`);
    }
};
