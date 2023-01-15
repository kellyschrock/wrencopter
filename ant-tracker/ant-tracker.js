#!/usr/bin/env node

'use strict';

const os = require("os");
const dgram = require("dgram");
const mavlink = require("./mavlink");
const MathUtils = require("./MathUtils");

function d(str) { console.log(str); }
function e(str) { console.error(str); }

let mavlinkLogger = null;
let mavlinkParser = null;
const SYSID = 255, COMPID = 190;

const homePosition = {
    valid: false
};

const vehicleLocation = {
    valid: false
};

function getIPAddresses() {
    const out = [];

    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach((key) => {
        interfaces[key].forEach((it) => {
            if (it.family == "IPv4") {
                out.push(it.address);
            }
        })

    });

    return out;
}

function onPacket(data) {
    if(mavlinkParser) {
        try {
            mavlinkParser.parseBuffer(data);
        } catch(ex) {
            e(ex.message);
        }
    }
}

const msgMap = {
    "GLOBAL_POSITION_INT": processGlobalPositionInt,
    "HOME_POSITION": processHomePosition
}

function onReceivedMavlinkMessage(msg) {
    const func = msgMap[msg.name];
    if(func) func(msg);
}

function connect() {
    const addresses = getIPAddresses();

    const client = dgram.createSocket("udp4");

    client.on("message", (message, rinfo) => {
        onPacket(message);
        // d(`message from ${rinfo.address}:${rinfo.port}: len=${message.length}`);
    }).on("close", () => {

    }).on("error", (error) => {
        e(`error: ${error.message}`);
    });

    try {
        client.bind({
            port: 14550
        });

        mavlinkParser = new MAVLink(mavlinkLogger, SYSID, COMPID);
        mavlinkParser.on("message", onReceivedMavlinkMessage);
    } catch (ex) {
        e(`Error binding socket: ${ex.message}`);
    }
}

function processHomePosition(msg) {
    const where = {
        lat: (msg.latitude / 1e7),
        lng: (msg.longitude / 1e7),
        alt: (msg.altitude / 1000) // mm to m
    };

    let homeUpdated = false;

    homeLocation.lat = where.lat;
    homeLocation.lng = where.lng;
    homeLocation.alt = where.alt;
    homeLocation.valid = true;

    checkLocations();
}

function processGlobalPositionInt(msg) {
    // e(`processGlobalPositionInt(${JSON.stringify(msg)})`);

    const lat = (msg.lat / 1E7);
    const lng = (msg.lon / 1E7);
    const altMSL = (msg.alt / 1000);
    const altAGL = (msg.relative_alt / 1000);

    const velocity = {
        x: msg.vx, y: msg.vy, z: msg.vz
    };

    Object.assign(vehicleLocation, {
        lat: lat, lng: lng, alt: altAGL, velocity: velocity,
        valid: true
    });

    checkLocations();
}

function checkLocations() {
    if(homeLocation.valid && vehicleLocation.valid) {
        const angle = MathUtils.getBearingFromCoordinates(homeLocation, vehicleLocation);
        d(`angle: ${angle}`);
    }
}

connect();


