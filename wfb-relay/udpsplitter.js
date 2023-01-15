#!/usr/bin/env node

'use strict';

const dgram = require("dgram");
const os = require("os");
const net = require("net");
const fs = require("fs");
const path = require("path");
const spawn = require("child_process").spawn;

const CMD_PORT = 7070;

function d(str) {
    console.log(`udpsplitter: ${str}`);
}

function e(str) {
    console.error(`udpsplitter: ${str}`);
}

// const clients = ["127.0.0.1", "192.168.6.14"];
const clients = ["127.0.0.1"];

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

function splitter(inPort, outPort) {

    const addresses = getIPAddresses();
    const listener = dgram.createSocket("udp4");
    const sender = dgram.createSocket("udp4");

    listener.on("message", function (message, rinfo) {
        // d(`sender address: ${rinfo.address}`);

        if(clients.indexOf(rinfo.address) != -1) {
      //      d(`${message.length} bytes from client ${rinfo.address}:${inPort}`);
        }

        // d(`message from ${rinfo.address}: length=${message.length}`)

        for (const addr of clients) {
	    // d(`send to ${addr}:${outPort}`);
            sender.send(message, outPort, addr, function (err, bytes) {
                if (err) {
                    e(err.message);
                }
            });
        }
    });

    d(`Listening for UDP at ${inPort}`);
    listener.bind(inPort);
}

function server(commandPort) {
    // Use net.createServer() in your code. This is just for illustration purpose.
    // Create a new TCP server.
    const server = new net.Server();

    // When a client requests a connection with the server, the server creates a new
    // socket dedicated to that client.
    server.on('connection', function (socket) {
        // The server can also receive data from the client by reading from its socket.
        socket.on('data', function (data) {
            const str = data.toString();

            const parts = str.trim().split(" ");
            const action = parts[0], address = parts[1];

            switch (action) {
                case "add": {
                    if (clients.indexOf(address) == -1) {
                        clients.push(address);
                        d(`added ip ${address}`);
                    }
                    break;
                }

                case "del": {
                    const idx = clients.indexOf(address);
                    if (idx != -1) {
                        clients.splice(idx, 1);
                        d(`removed ip ${address}`);
                    }
                    break;
                }
            }

        });

        // When the client requests to end the TCP connection with the server, the server
        // ends the connection.
        socket.on('end', function () {
            // console.log('Closing connection with the client');
        });

        // Don't forget to catch error, for your own sake.
        socket.on('error', function (err) {
            console.log(`Error: ${err}`);
        });
    });

    // The server listens to a socket for a client to make a connection request.
    // Think of a socket as an end point.
    server.listen(commandPort, function () {
        console.log(`Server listening for connection requests on socket localhost:${CMD_PORT}`);
    });
}

function usage() {
    const str = `
        Usage: ${process.argv[1]} CMD_PORT IN_PORT OUT_PORT

        Responds to 2 commands:
        add (ip_address)
        del (ip_address)

        Added IP addresses receive whatever data is received on IN_PORT.
    `;
    d(str);
}

function runScript(name) {
    const file = path.join(__dirname, name);
    if (fs.existsSync(file)) {
        const child = spawn("/bin/sh", [file], { shell: true });

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

if(process.argv.length < 5) {
    usage();
    process.exit(1);
}

const cmdPort = parseInt(process.argv[2]);
const inPort = parseInt(process.argv[3]);
const outPort = parseInt(process.argv[4]);

if(isNaN(cmdPort) || isNaN(inPort) || isNaN(outPort)) {
    usage();
    process.exit(2);
}

splitter(inPort, outPort);
server(cmdPort);
