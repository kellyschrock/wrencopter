'use strict';

const fs = require("fs");

const CMD_FIFO = "/tmp/cam_control.fifo";
const CFG_FIFO = "/tmp/cam_config.fifo";

//
// Control a fictional camera
//
var mRecordingVideo = false;
var mEvComp = 0.0;
let mBrightness = 50;
let mFocus = 0; // far focus
let mZoom = 0; // no zoom

const MIN_BRIGHTNESS = 10;
const MAX_BRIGHTNESS = 100;
const BRIGHTNESS_STEP = 10;

const MIN_FOCUS = 0;
const MAX_FOCUS = 1023;
const FOCUS_STEP = 50

const MIN_ZOOM = 0;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1;

function d(str) { console.log(`camera: ${str}`); }
function e(str) { console.error(`camera: ${str}`); }

function formatLatitude(lat) {
    const val = (lat * 1000000).toFixed(0);
    return `${val} / 1000000`;
}

function formatLongitude(lng) {
    const val = (lng * 1000000).toFixed(0);
    return `${val} / 1000000`;
}

function formatAltitude(alt) {
    const val = (alt * 1000000).toFixed(0);
    return `${val} / 1000000`;
}

function setLocation(where) {
    if(!where) return;
    if(!where.lat) return;
    if(!where.lng) return;

    sendFifoCommand(`exif:GPS.GPSLatitude=${formatLatitude(where.lat)}`);
    sendFifoCommand(`exif:GPS.GPSLongitude=${formatLongitude(where.lng)}`);

    if(where.altAMSL) {
        sendFifoCommand(`exif:GPS.GPSAltitude=${formatAltitude(where.altAMSL)}`);
    }
}

function sendFifoCommand(command) {
    // d(`sendToFifo(${command})`);

    const { exec } = require("child_process");

    exec(`echo ${command} > ${CMD_FIFO}`, (err, stdout, stderr) => {
        if(err) {
            return d(`Error writing FIFO: ${err.message}`);
        }

        if(stderr) {
            return d(`stderr: ${stderr}`);
        }
    });
}

function sendFifoConfig(str) {
    d(`sendFifoConfig(${str})`);

    const { exec } = require("child_process");

    exec(`echo ${str} > ${CFG_FIFO}`, (err, stdout, stderr) => {
        if (err) {
            return d(`Error writing FIFO: ${err.message}`);
        }

        if (stderr) {
            return d(`stderr: ${stderr}`);
        }
    });
}

function init() {
    d(`init()`);
}

function close() {
    d(`close()`);
}

function takePicture(callback) {
    try {
        sendFifoCommand("picture");
        callback(null, true);
    } catch(ex) {
        e(ex.message);
        callback(ex, false);
    }
}

function startVideo(callback) {
    try {
        sendFifoCommand("record:start");
        mRecordingVideo = true;
        callback(null, mRecordingVideo);
    } catch(ex) {
        e(ex.message);
        callback(ex, false);
    }
}

function stopVideo(callback) {
    try {
        sendFifoCommand("record:stop");
        mRecordingVideo = false;
        callback(null, mRecordingVideo);
    } catch (ex) {
        e(ex.message);
        callback(ex, false);
    }
}

function toggleVideo(callback) {
    const func = (mRecordingVideo)?
        stopVideo: startVideo;

    func(callback);
}

function incrementEVComp(cb) {
    const newEvComp = mEvComp + 0.5;
    if(newEvComp <= 3.0) {
        mEvComp = newEvComp;
    }
    
    cb(null, mEvComp);
}

function decrementEVComp(cb) {
    const newEvComp = mEvComp - 0.5;
    if (newEvComp >= -3.0) {
        mEvComp = newEvComp;
    }

    cb(null, mEvComp);
}

function doConfig(prop, value) {
    sendFifoConfig(`${prop}=${value}`);
}

exports.setAwb = function(value) {
    const awb = value && value.awb;
    if(awb && awb.id) {
        sendFifoConfig(`awb ${awb.id}`);
    }
}

exports.setISO = function(value) {
    d(`setISO(): value=${JSON.stringify(value)}`);

    const iso = value && value.iso;
    if(iso && iso.id) {
        sendFifoConfig(`iso ${iso.id}`);
    }
}

exports.brightnessUp = function () {
    if (mBrightness < MAX_BRIGHTNESS) {
        mBrightness += BRIGHTNESS_STEP;
        sendFifoConfig(`brightness ${mBrightness}`);
    }
};

exports.brightnessDown = function() {
    if(mBrightness > MIN_BRIGHTNESS) {
        mBrightness -= BRIGHTNESS_STEP;
        sendFifoConfig(`brightness ${mBrightness}`);
    }
};

exports.brightness = function() { return mBrightness; }

exports.doVFlip = function(doit) {
    sendFifoConfig(`vflip ${doit? "true": "false"}`);
};

exports.focusUp = function() {
    mFocus += FOCUS_STEP;
    if(mFocus > MAX_FOCUS) {
        mFocus = MAX_FOCUS;
    }

    sendFifoConfig(`focus ${mFocus}`);
}

exports.focusDown = function() {
    mFocus -= FOCUS_STEP;
    if(mFocus < MIN_FOCUS) {
        mFocus = MIN_FOCUS;
    }

    sendFifoConfig(`focus ${mFocus}`);
}

exports.focus = function () {
    return `${((mFocus / MAX_FOCUS) * 100).toFixed(0)}%`;
}

exports.zoomIn = function() {
    mZoom += ZOOM_STEP;
    if(mZoom > MAX_ZOOM) {
        mZoom = MAX_ZOOM;
    }

    sendFifoConfig(`zoom ${mZoom}`);
}

exports.zoomOut = function() {
    mZoom -= ZOOM_STEP;
    if(mZoom < MIN_ZOOM) {
        mZoom = MIN_ZOOM;
    }

    sendFifoConfig(`zoom ${mZoom}`);
}

exports.zoom = function() {
    return mZoom;
}

exports.init = init;
exports.close = close;
exports.takePicture = takePicture;
exports.startVideo = startVideo;
exports.stopVideo = stopVideo;
exports.toggleVideo = toggleVideo;
exports.incrementEVComp = incrementEVComp;
exports.decrementEVComp = decrementEVComp;
exports.setLocation = setLocation;
exports.doConfig = doConfig;
