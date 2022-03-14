'use strict';

const fs = require("fs");
const path = require("path");

const camera = require("./camera.js");

const DEF_MEDIA_SERVER_PORT = 5595;
const DEF_MEDIA_PATH = "/home/pi/video";

const ATTRS = {
    id: "picamera",
    // Name/description
    name: "Pi Camera",
    description: "Raspberry Pi camera",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: []
};

let api = null;
let mConfig = {};
let lastHeartbeatTime = 0;

function getMediaPath() { return mConfig.media_path || DEF_MEDIA_PATH; }
function getMediaServerPort() { return mConfig.media_server_port || DEF_MEDIA_SERVER_PORT; }

function d(str) {
    ATTRS.log(ATTRS.id, str);
}

function e(str) {
    console.error(`${ATTRS.id}: ${str}`);
}

const vehicleEventListener = {
    onDroneEvent: (event, extras) => {
        switch(event) {
            case ATTRS.api.Vehicle.Events.LOCATION_UPDATED: {
                onVehicleMoved(extras);
                break;
            }
        }
    }
};

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
    const messages = ATTRS.api.Vehicle.getVehicleMavlinkMessages();

    messages.push("COMMAND_LONG");
    messages.push("CAMERA_FEEDBACK");

    ATTRS.api.Vehicle.addEventListener(vehicleEventListener);
    ATTRS.subscribeMavlinkMessages(ATTRS.id, messages);

    if(camera.init) {
        camera.init();
    }

    const filename = path.join(__dirname, "config.json");
    if(fs.existsSync(filename)) {
        try {
            const content = fs.readFileSync(filename);
            const jo = JSON.parse(content.toString());
            Object.assign(mConfig, jo);
            d(`config=${JSON.stringify(mConfig)}`);
        } catch(ex) {
            e(ex.message);
        }
    }
}

// Called when unloading
function onUnload() {
    d("onUnload()");

    if(camera.close) {
        camera.close();
    }

    if(ATTRS.api.Vehicle.removeEventListener) {
        ATTRS.api.Vehicle.removeEventListener(vehicleEventListener);
    }
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
        case "take_picture": {
            camera.takePicture(function(err) {
                if(err) {
                    result.ok = false;
                    result.message = err.message;
                    sendCameraError(err.message);
                }
            });
            break;
        }

        case "toggle_video": {
            camera.toggleVideo(function(err, recording) {
                if(err) {
                    result.ok = false;
                    result.message = err.message;
                    sendCameraError("Failed to toggle video");
                } else {
                    sendUpdateRecordingStatus(recording);
                }
            });
            break;
        }

        case "retrieve_files": {
            const files = [];
            const dir = getMediaPath();
            const filenames = fs.readdirSync(dir);
            filenames.forEach((dirent) => {
                const filename = dirent;

                if(filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".mp4")) {
                    const stats = fs.statSync(path.join(dir, filename));

                    const when = new Date(stats.mtime).getTime();
                    files.push({ name: filename, size: stats.size, time: when });
                }
            });

            // Sort the list newest-first.
            files.sort((a, b) => { return b.time - a.time; });

            result.ok = true;
            result.data = { files: files };
            break;
        }

        case "get_media_host": {
            const ip = getHostIP();
            if(ip) {
                 result.host = {
                     ip: ip, port: getMediaServerPort()
                 };
                 result.ok = true;
            } else {
                result.ok = false;
                result.message = "Unable to get IP address";
            }
            break;
        }

        case "delete_file": {
            const file = path.join(getMediaPath(), msg.filename);
            d(`file=${file}`);
            if(fs.existsSync(file)) {
                fs.unlink(file, (err) => {
                    if(err) {
                        result.ok = false;
                    }
                    else result.ok = true;
                });
            } else {
                result.ok = false;
                result.message = `${msg.filename} not found`;
            }
            break;
        }

        case "delete_all": {
            const dir = getMediaPath();
            const filenames = fs.readdirSync(dir);

            filterForMedia(filenames).forEach((name) => {
                const filename = path.join(dir, name);
                // d(`filename=${filename}`);

                if(fs.existsSync(filename)) {
                    fs.unlink(filename, (err) => {
                        if(err) {
                            d(`Error deleting ${filename}: ${err.message}`);
                        } else {
                            d(`Deleted ${filename}`);
                        }
                    });
                }
            });

            result.ok = true;
            break;
        }

        case "set_awb": {
            camera.setAwb(msg);
            break;
        }

        case "set_iso": {
            camera.setISO(msg);
            break;
        }

        case "open_settings": {
            sendSettingsDialogMessage();
            break;
        }

        case "set_config": {
            camera.doConfig(msg.prop, msg.value);
            break;
        }

        case "brightness_up": {
            camera.brightnessUp();
            sendBrightnessUpdate(camera.brightness());
            break;
        }

        case "brightness_down": {
            camera.brightnessDown();
            sendBrightnessUpdate(camera.brightness());
            break;
        }

        case "do_vflip": {
            camera.doVFlip(msg.checked);
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

//
// Return a UI for the specified screen.
//
function onScreenEnter(screen) {
    switch(screen) {
        case api.WorkerUI.Const.SCREEN_FLIGHT: {
            const body = api.WorkerUI.loadLayout(__dirname, api.WorkerUI.Const.PANEL_CAMERA);

            return (body)? {
                screen_id: screen, 
                camera_panel: body
            }: null;
        }

        default: {
            return null;
        }
    }
}

function onScreenExit(screen) {

}

// Serve an image if it exists.
function onImageDownload(name) {
    return api.WorkerUI.serveImage(__dirname, name);
}

function sendCameraError(str) {
    api.WorkerUI.sendSpeechMessage(ATTRS, str, api.WorkerUI.SpeechType.ERROR);
}

function sendBrightnessUpdate(brightness) {
    ATTRS.sendGCSMessage(ATTRS.id, {
        id: "screen_update",
        screen_id: "flight",
        panel_id: "camera_panel",
        values: {
            txt_brightness: {
                text: `${brightness}`
            }
        }
    });
}

function sendUpdateRecordingStatus(recording) {
    const imgName = (recording) ? "record_on.png" : "record_off.png";

    ATTRS.sendGCSMessage(ATTRS.id, {
        id: "screen_update",
        screen_id: "flight",
        panel_id: "camera_panel",
        values: {
            btn_video: {
                icon: `$(img)/${ATTRS.id}/${imgName}`
            },
            spin_frame_rate: { enabled: !recording },
            btn_evcomp_add: { enabled: !recording },
            btn_evcomp_sub: { enabled: !recording }
        }
    });
}

function sendSettingsDialogMessage() {
    const body = api.WorkerUI.loadLayout(__dirname, "camera_settings");
    if (body) {
        ATTRS.sendGCSMessage(ATTRS.id, { id: "display_dialog", content: body });
    }
}

function sendEVCompUpdate(evcomp) {
    ATTRS.sendGCSMessage(ATTRS.id, {
        id: "screen_update",
        screen_id: "flight",
        panel_id: "camera_panel",
        values: {
            txt_evcomp: {
                text: evcomp.toFixed(2)
            }
        }
    });
}

function onBroadcastRequest(msg) {
    switch(msg.type) {
        case "mission_item_support": {
            return {
                id: ATTRS.id,
                name: ATTRS.name,
                actions: [
                    { 
                        id: "video_start", 
                        name: "Start Video", 
                        msg_id: "video_start", 
                        params: [
                            {id: "frame_rate", name: "Frame rate", type: "enum", values: [
                                {id: "low", name: "Low"},
                                {id: "med", name: "Medium"},
                                {id: "hi", name: "High"}
                            ], 
                            default: "med"}
                        ]
                    },
                    { id: "video_stop", name: "Stop Video", msg_id: "video_stop" },
                    { id: "photo", name: "Take Photo", msg_id: "take_photo" },
                ]
            }
        }

        default: {
            return null;
        }
    }
}

function getFeatures() {
    d("getFeatures()");

    const ipAddress = getHostIP();

    if(!ipAddress) return null;

    // Return a single feature, or multiple
    return {
        video: {
            supported: true,
            endpoints: [
                {
                    name: "TCP",
                    type: "tcp",
                    ip: ipAddress,
                    port: 5400
                },
                {
                    name: "UDP",
                    type: "udp",
                    ip: ipAddress,
                    port: 5400
                }
            ],
            cameras: [
                { id: "picamera", name: "Pi Camera" }
            ]
        }
    };
}

function getHostIP() {
    const os = require("os");
    const nets = os.networkInterfaces();
    const results = Object.create({});

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // skip over non-ipv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                if (!results[name]) {
                    results[name] = [];
                }

                results[name].push(net.address);
            }
        }
    }

    try {
        return results[Object.keys(results)[0]][0];
    } catch(ex) {
        console.error(ex.message);
        return null;
    }
}

function filterForMedia(files) {
    const output = [];

    files.forEach((file) => {
        if(file.endsWith(".jpg") || file.endsWith(".mp4") || file.endsWith(".png")) {
            output.push(file);
        }
    });

    return output;
}

function onVehicleMoved(where) {
    camera.setLocation(where);
}

function sendCameraHeartbeat(sysid) {
    const now = Date.now();

    if ((now - lastHeartbeatTime) > 4000) {
        d(`sendCameraHeartbeat(${sysid})`);
        const mavlink = ATTRS.api.Mavlink;

        const msg = {
            header: {
                sysid: sysid, compid: mavlink.MAV_COMP_ID_CAMERA
            },
            name: "HEARTBEAT",
            type: mavlink.MAV_TYPE_CAMERA,
            base_mode: 0,
            custom_mode: 0,
            system_status: 0
        };

        ATTRS.sendMavlinkMessage(ATTRS.id, msg);
        lastHeartbeatTime = now;
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
exports.onImageDownload = onImageDownload;
exports.onBroadcastRequest = onBroadcastRequest;
exports.getFeatures = getFeatures;
