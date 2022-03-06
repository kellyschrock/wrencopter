'use strict';

const fs = require("fs");

const CMD_FIFO = "/tmp/cam_control.fifo";
const CFG_FIFO = "/tmp/cam_config.fifo";

//
// Control a fictional camera
//
var mRecordingVideo = false;
var mEvComp = 0.0;

let cmdWriteStream = null;
let cfgWriteStream = null;

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
    if(cmdWriteStream) {
        try {
            cmdWriteStream.write(`${command}\n`);
        } catch(ex) {
            e(ex.message);
        }
    }
}

function sendFifoConfig(str) {
    if(cfgWriteStream) {
        try {
            cfgWriteStream.write(`${str}\n`);
        } catch(ex) {
            e(ex.message);
        }
    }
}

function init() {
    try {
        if(fs.existsSync(CMD_FIFO)) {
            cmdWriteStream = fs.createWriteStream(CMD_FIFO);
        }

        if(fs.existsSync(CFG_FIFO)) {
            cfgWriteStream = fs.createWriteStream(CFG_FIFO);
        }
    } catch(ex) {
        e(ex.message);
    }
}

function close() {
    try {
        if(cmdWriteStream) {
            cmdWriteStream.close();
        }

        if(cfgWriteStream) {
            cfgWriteStream.close();
        }
    } catch(ex) {
        e(ex.message);
    }
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
