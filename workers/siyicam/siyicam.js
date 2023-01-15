'use strict';

// Connection:
// Serial port: 115200 N81
// UDP: 192.168.144.25:37260

const {
    crc16Calc,
    getUint16BytesLE
} = require("./siyi_crc");

const CMDID_FIRMWARE_VERSION = 0x01;
const CMDID_HARDWARE_ID = 0x02;
const CMDID_AUTOFOCUS = 0x04;
const CMDID_ZOOM = 0x05;
const CMDID_MANUAL_FOCUS = 0x06;
const CMDID_GIMBAL_ROTATION = 0x07;
const CMDID_GIMBAL_CENTER = 0x08;
const CMDID_GET_GIMBAL_CONFIG = 0x0A;
const CMDID_FUNC_FEEDBACK = 0x0B;
const CMDID_TAKE_PHOTO = 0x0C;
const CMDID_GET_GIMBAL_ATTITUDE = 0x0D;

// Command sequence number
let seqNumber = 0;

function d(str) { console.log(`siyicam: ${str}`); }
function e(str) { console.error(`siyicam: ${str}`); }

function sendPacket(packet) {
    d(`sendPacket(): ${packet}`);
    // TODO: Send to whatever serial port the camera is connected to.
}

const SEQ_INDEX = 5;
function preparePacket(bytes) {
    if(bytes && bytes.length > 5) {
        const seqBytes = getUint16BytesLE(seqNumber++);
        bytes[SEQ_INDEX] = seqBytes[0];
        bytes[SEQ_INDEX + 1] = seqBytes[1];
    }

    const crc = crc16Calc(bytes, bytes.length, 0);
    const end = getUint16BytesLE(crc);

    if(end && end.forEach) {
        end.forEach(b => bytes.push(b));
    } else {
        return null;
    }

    return bytes;
}

const ZOOMCMD_IN = 0x01;
const ZOOMCMD_STOP = 0x00;
const ZOOMCMD_OUT = 0xFF; // -1
function getCameraZoomCommand(zoomCommand) {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_ZOOM, zoomCommand]);
}

const MFCMD_IN = 0x01;
const MFCMD_STOP = 0x00;
const MFCMD_OUT = 0xFF;
function getManualFocusCommand(cmd) {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_MANUAL_FOCUS, cmd]);
}

// Roll and yaw are both -100~0~100. 0 is center. Higher numbers away from 0 are faster in 
// a given direction (not sure which)
function getGimbalRotateCommand(yaw, pitch) {
    return preparePacket([0x55, 0x66, 0x01, 0x02, 0x00, 0x00, 0x00, CMDID_GIMBAL_ROTATION, yaw, pitch]);
}

function getGimbalCenterCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_GIMBAL_CENTER, 0x01]);
}

const PHOTOCMD_TAKE_PICTURE = 0x00;
const PHOTOCMD_TOGGLE_VIDEO = 0x02;
const PHOTOCMD_MOTION_LOCK = 0x03;
const PHOTOCMD_MOTION_FOLLOW = 0x04;
const PHOTOCMD_MOTION_FPV = 0x05;
function getToggleVideoCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_TAKE_PHOTO, PHOTOCMD_TOGGLE_VIDEO]);
}

function getTakePictureCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_TAKE_PHOTO, PHOTOCMD_TAKE_PICTURE]);
}

function getMotionLockCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_TAKE_PHOTO, PHOTOCMD_MOTION_LOCK]);
}

function getMotionFollowCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_TAKE_PHOTO, PHOTOCMD_MOTION_FOLLOW]);
}

function getMotionFPVCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_TAKE_PHOTO, PHOTOCMD_MOTION_FPV]);
}

function getAutoFocusCommand() {
    return preparePacket([0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, CMDID_AUTOFOCUS, 0x01]);
}

class SiyiCamera {
    constructor() {
        seqNumber = 0;
    }

    autoFocus() {
        sendPacket(getAutoFocusCommand());
    }

    autoCenter() {
        sendPacket(getGimbalCenterCommand());
    }

    zoomIn() {
        sendPacket(getCameraZoomCommand(ZOOMCMD_IN));
    }

    zoomOut() {
        sendPacket(getCameraZoomCommand(ZOOMCMD_OUT));
    }

    zoomStop() {
        sendPacket(getCameraZoomCommand(ZOOMCMD_STOP));
    }

    manualFocusIn() {
        sendPacket(getManualFocusCommand(MFCMD_IN));
    }

    manualFocusOut() {
        sendPacket(getManualFocusCommand(MFCMD_OUT));
    }

    manualFocusStop() {
        sendPacket(getManualFocusCommand(MFCMD_STOP));
    }

    gimbalYaw(direction, speed) {
        sendPacket(getGimbalRotateCommand((direction * Math.min(100, speed)).toFixed(0), 0));
    }

    gimbalPitch(direction, speed) {
        sendPacket(getGimbalRotateCommand(0, (direction * Math.min(100, speed)).toFixed(0)));
    }

    gimbalCenter() {
        sendPacket(getGimbalCenterCommand());
    }

    takePicture() {
        sendPacket(getTakePictureCommand());
    }

    toggleVideoRecord() {
        sendPacket(getToggleVideoCommand());
    }

    motionLock() {
        sendPacket(getMotionLockCommand());
    }

    motionFollow() {
        sendPacket(getMotionFollowCommand());
    }

    motionFPV() {
        sendPacket(getMotionFPVCommand());
    }
}

exports.SiyiCamera = SiyiCamera;

const CMD_ZOOM_EXAMPLE = [
    0x55, 0x66, // header
    0x01,       // Need ack: 1 = true, 0 = false
    0x01, 0x00, // Data len (low byte first)      
    0x00, 0x00, // Seq (low byte first)
    0x05,       // Cmd id
    0x01,       // Data (num bytes at this position equal to data len)
    0x8d, 0x64  // CRC (low byte first)
];

// TODO: Dissect these and get to know them better.
// Zoom 1
const CMD_ZOOM_IN = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x05, 0x01, 0x8d, 0x64];
// Zoom - 1
const CMD_ZOOM_OUT = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x05, 0xFF, 0x5c, 0x6a];
// Manual Focus 1
const CMD_MANUAL_FOCUS_IN = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0xde, 0x31];
// Manual Focus - 1
const CMD_MANUAL_FOCUS_OUT = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x06, 0xff, 0x0f, 0x3f];
// Take Pictures
const CMD_TAKE_PICTURE = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x34, 0xce];
// Record Video
const CMD_RECORD_VIDEO = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x0c, 0x02, 0x76, 0xee];
// Rotate 100 100
const CMD_ROTATE_100_X = [0x55, 0x66, 0x01, 0x02, 0x00, 0x00, 0x00, 0x07, 0x64, 0x64, 0x3d, 0xcf];
// Auto Centering
const CMD_AUTO_CENTERING = [0x55, 0x66, 0x01, 0x01, 0x00, 0x00, 0x00, 0x08, 0x01, 0xd1, 0x12];

/*
Field       Index   Bytes       Description
STX         0       2           0x6655: starting mark
                                Low byte in the front
CTRL        2       1           0: need_ack(if the current data pack need “ack”)
                                1: ack_pack(if the current data pack is an “ack” package)
                                2 - 7: reserved
Data_len    3       2           Data field byte length
                                Low byte in the front
SEQ         5       2           Frame sequence(0 ~65535)
                                Low byte in the front
CMD_ID      7       1           Command ID
DATA        8       Data_len    Data
CRC16       ?       2           CRC16 check to the complete data package.
                                Low byte in the front
*/

function toHexString(bytes) {
    let out = "";

    bytes.forEach((b) => {
        out = `${out} ${b.toString(16)}`;
    });

    return out;
}

function testPackets() {

    function dump(name, packet) {
        d(`${name}:\t\t${toHexString(packet)}`);
    }

    let seq = 0;
    for(let i = 0; i < 1; ++i) {
        dump("autofocus", getAutoFocusCommand(seq++));
        dump("zoom in", getCameraZoomCommand(ZOOMCMD_IN, seq++));
        dump("zoom out", getCameraZoomCommand(ZOOMCMD_OUT, seq++));
        dump("zoom stop", getCameraZoomCommand(ZOOMCMD_STOP, seq++));
        dump("manual in", getManualFocusCommand(MFCMD_IN, seq++));
        dump("manual out", getManualFocusCommand(MFCMD_OUT, seq++));
        dump("manual stop", getManualFocusCommand(MFCMD_STOP, seq++));
        dump("gimbal yaw", getGimbalRotateCommand(10, 0, seq++));
        dump("gimbal pitch", getGimbalRotateCommand(0, 10, seq++));
        dump("gimbal center", getGimbalCenterCommand(seq++));
        dump("motion_fpv", getMotionFPVCommand(seq++));
    }
}

if(require.main == module) {
    testPackets();
}