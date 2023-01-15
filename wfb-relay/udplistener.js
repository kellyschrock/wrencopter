#!/usr/bin/env node
'use strict';

const os = require("os");

const dgram = require("dgram");

function d(str) { console.log(str); }
function e(str) { console.error(str); }

function getIPAddresses() {
    const out = [];

    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach((key) => {
        interfaces[key].forEach((it) => {
            if(it.family == "IPv4") {
                out.push(it.address);
            }
        })

    });

    return out;
}

function connect() {
    const addresses = getIPAddresses();

    const client = dgram.createSocket("udp4");

    client.on("message", (message, rinfo) => {
        if(addresses.indexOf(rinfo.address) == -1) {
            d(`message from ${rinfo.address}:${rinfo.port}: len=${message.length}`);
        }
    }).on("close", () => {

    }).on("error", (error) => {
        e(`error: ${error.message}`);
    });

    try {
        client.bind({
            port: 14550
        });
    } catch(ex) {
        e(`Error binding socket: ${ex.message}`);
    }
}

connect();
