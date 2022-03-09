#!/usr/bin/env node

'use strict';

const fs = require("fs");
const { networkInterfaces } = require("os");

function getLocalIP() {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family == "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }

    return null;
}

function doConfig(infile, outfile) {
    if(!fs.existsSync(infile)) {
        console.log(`No ${infile} file found`);
        process.exit(127);
    }

    const ip = getLocalIP();

    if (!ip) {
        console.error("Can't get local IP address");
        process.exit(1);
    }

    const last = ip.lastIndexOf(".");
    const bcast = `${ip.substring(0, last)}.255`;

    try {
        const content = fs.readFileSync(infile).toString();

        let modded = content;
        while(modded.includes("_BCAST_IP_")) {
            modded = modded.replace("_BCAST_IP_", bcast);
        }

        fs.writeFileSync(outfile, modded);
    } catch(ex) {
        console.error(ex.message);
    }
}

// Get the command line params and make sure there's a file there.
if(process.argv.length < 4) {
    console.log(`
        Usage: setconfig templatefile configfile
    `);
    process.exit(1);
}

doConfig(process.argv[2], process.argv[3]);
