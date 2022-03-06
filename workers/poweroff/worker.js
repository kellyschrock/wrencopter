'use strict';

const fs = require("fs");
const path = require("path");

const { exec } = require("child_process");

const ATTRS = {
    id: "poweroff",
    // Name/description
    name: "Poweroff/Reboot",
    description: "Power-off/reboot menu items",
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

/*
Return an object describing this worker. If looper is true, this module must expose a loop() export.
*/
function getAttributes() {
    return ATTRS;
}

// Called from dispatch.loop()
function loop() {
}

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");
    api = ATTRS.api;
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    // d(`onMavlinkMessage(): ${msg.name}`);

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
        case "power_off": {
            doPoweroff();
            break;
        }

        case "reboot": {
            doReboot();
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

function doPoweroff() {
    exec("sudo shutdown -h now", (err, stdout, stderr) => {
        if(err) return d(`Error shutting down: ${ex.message}`);
    });
}

function doReboot() {
    exec("sudo reboot now", (err, stdout, stderr) => {
        if(err) return d(`Error rebooting: ${ex.message}`);
    });
}

//
// Return a UI for the specified screen.
//
function onScreenEnter(screen, type) {
    switch(type) {
        case "html": {
            switch(screen) {
                case ATTRS.api.WorkerUI.Const.SCREEN_START: {
                    // const body = loadHTMLLayoutFor(ATTRS.api.WorkerUI.Const.PANEL_WORKER_BUTTONS);
                    const body = loadHTMLLayoutFor("worker_menu");

                    return (body) ? {
                        screen_id: screen,
                        worker_menu: body
                    } : null;
                }

                default: {
                    return null;
                }
            }            
            break;
        }
        
        default: {
            switch (screen) {
                // TODO: Make this add a couple of menu items to the start screen.
                case api.WorkerUI.Const.SCREEN_FLIGHT: {
                    const body = api.WorkerUI.loadLayout(__dirname, api.WorkerUI.Const.PANEL_CAMERA);

                    return (body) ? {
                        screen_id: screen,
                        camera_panel: body
                    } : null;
                }

                default: {
                    return null;
                }
            }
            break;
        }
    }
}

function loadHTMLLayoutFor(panel) {
    const fs = require("fs");
    const path = require("path");

    const file = path.join(path.join(__dirname, "ui"), `${panel}.html`);
    d(`load: ${panel}: file=${file}`);

    if (fs.existsSync(file)) {
        try {
            const content = fs.readFileSync(file);
            return content.toString("utf8");
        } catch (ex) {
            console.error(ex.message);
        }
    }

    return null;
}

function onScreenExit(screen) {

}

function sendResponseMessage(str) {
    api.WorkerUI.sendSpeechMessage(ATTRS, str, api.WorkerUI.SpeechType.ERROR);
}

function sendSettingsDialogMessage() {
    const body = api.WorkerUI.loadLayout(__dirname, "camera_settings");
    if (body) {
        ATTRS.sendGCSMessage(ATTRS.id, { id: "display_dialog", content: body });
    }
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
exports.onScreenEnter = onScreenEnter;
exports.onScreenExit = onScreenExit;
