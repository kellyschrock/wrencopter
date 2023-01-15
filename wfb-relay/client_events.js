#!/usr/bin/env node

'use strict';

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Tail = require("always-tail");

function d(str) { console.log(str); }
function e(str) { console.error(str); }

const clients = {};

function onClientAdded(ip) {
    d(`Client added: ${ip}`)
    runScript("on_connect", ip);
}

function onClientRemoved(ip) {
    d(`Client removed: ${ip}`);
    runScript("on_disconnect", ip);
}

// Nov 27 19:45:16 wfbgs dnsmasq-dhcp[544]: DHCPACK(wlan0) 192.168.6.14 6e:e6:28:46:04:b4 Galaxy-Tab-S6-Lite
function onDHCPACK(line) {
    let index = line.indexOf("DHCPACK(wlan0) ");
    if(index == -1) return;
    index += "DHCPACK(wlan0) ".length;

    let spaceIndex = line.substring(index).indexOf(" ");
    const ip = line.substring(index, index + spaceIndex);
    index = (index + spaceIndex) + 1; // space
    spaceIndex = line.substring(index).indexOf(" ");
    const mac = line.substring(index, index + spaceIndex);

    // Map the MAC address to the IP
    // d(ip);
    // d(mac);

    if(mac && ip) {
        clients[mac] = ip;
        onClientAdded(ip);
    }

    // d(`add: clients=${JSON.stringify(clients)}`)
}

// Nov 27 22:03:55 wfbgs hostapd: wlan0: STA 6e:e6:28:46:04:b4 IEEE 802.11: disassociated
function onDisassociated(line) {
    let index = line.indexOf(": STA ")
    index += ": STA ".length;
    let spaceIndex = line.substring(index).indexOf(" ");
    const mac = line.substring(index, index + spaceIndex);
    // d(mac);

    if(mac) {
        const ip = clients[mac];
        if(ip) {
            onClientRemoved(ip);
        }

        delete clients[mac];
    }

    // d(`del: clients=${JSON.stringify(clients)}`);
}

// Monitor the specified file and alert when specific lines appear in it.
function monitorFile(filename) {
    const tail = new Tail(filename, "\n");
    tail.on("line", (line) => {
        if (line.includes("DHCPACK(wlan0)")) {
            onDHCPACK(line);
        } else if (line.includes("IEEE 802.11: disassociated")) {
            onDisassociated(line);
        }
    }).on("error", (err) => {
        e(err.message);
    });

    tail.watch();
}

function runScript(name, input) {
    const file = path.join(__dirname, name);
    if (fs.existsSync(file)) {
        const child = spawn("/bin/sh", [file, input], { shell: true });

        child.on("error", function (err) {
            d(`Error starting ${file}: ${err}`);
        });

        child.stdout.on("data", function (data) {
            d(`stdout from ${file}: ${data}`);
        });

        child.on("close", function (code) {
            d(`${file} ended with RC ${code}`);
        });
    } else {
        d(`No on_connect script found at ${file}`);
    }
}

// -- main
let logfile = "/var/log/syslog";

if(process.argv.length == 3) {
    logfile = process.argv[2];

    if(!fs.existsSync(logfile)) {
        e(`File ${logfile} not found`);
        process.exit(100);
    }
}

function test() {
    onDHCPACK("Nov 27 19:45:16 wfbgs dnsmasq-dhcp[544]: DHCPACK(wlan0) 192.168.6.14 6e:e6:28:46:04:b4 Galaxy-Tab-S6-Lite");

    onDisassociated("Nov 27 22:03:55 wfbgs hostapd: wlan0: STA 6e:e6:28:46:04:b4 IEEE 802.11: disassociated");
}
// test();

monitorFile(logfile);



