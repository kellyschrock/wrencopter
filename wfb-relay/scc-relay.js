#!/usr/bin/env node
'use strict';

// TODO: Make this listen to all incoming http and websocket requests and forward them on to the target IP
// and forward all responses from the target IP to the caller. 

const http = require("http");
const WebSocket = require("ws");

let targetHost = null;
let targetPort = 0;

function d(str) { console.log(str); }
function e(str) { console.error(str); }

function doGET(req, res) {
    d(`Method is a GET`);

    const headers = Object.assign({}, req.headers);
    headers.host = targetHost;

    const options = {
        host: targetHost,
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: headers
    };

    try {
        const req = http.request(options, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (data) => {
                body += data;
            }).on("end", () => {
                d(`response.body=${body}`);
            });

            response.pipe(res);
        });

        d(`Send GET request`);
        req.end();
    } catch (ex) {
        e(ex.message);

        res.writeHead(500);
        res.end(`${ex.message}\n`);
    }
}

function doPOST(req, res) {
    d(`Method is a POST`);

    let reqBody = "";
    req.on("data", (data) => {
        reqBody += data.toString();
    });

    req.on("end", () => {
        d(`request body: ${reqBody}`);

        const headers = Object.assign({}, req.headers);
        headers.host = targetHost;
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = (reqBody && reqBody.length) || 0;

        const options = {
            host: targetHost,
            port: targetPort,
            path: req.url,
            method: req.method,
            headers: headers
        };

        try {
            const req = http.request(options, (response) => {
                // d(`response: ${response}`);

                let body = "";
                response.setEncoding("utf8");
                response.on("data", (data) => {
                    body += data;
                }).on("end", () => {
                    d(`response.body=${body}`);
                });

                response.pipe(res);
            });

            if (reqBody) {
                d(`Write POST body: ${reqBody}`)
                req.write(reqBody);
            }

            d(`Send POST request`);
            req.end();
        } catch (ex) {
            e(ex.message);

            res.writeHead(500);
            res.end(`${ex.message}\n`);
        }
    });
}

function requestListener(req, res) {
    d(`request: ${req.url} method=${req.method}`);

    switch(req.method) {
        case "POST": {
            doPOST(req, res);
            break;
        }

        case "GET": {
            doGET(req, res);
            break;
        }

        default: {
            d(`Unknown request method: ${req.method}`);
            break;
        }
    }
}

if(process.argv.length >= 4) {
    targetHost = process.argv[2];
    targetPort = process.argv[3];
}

if(!targetHost || !targetPort) {
    e(`\nUsage:\n${process.argv[1]} target_host target_port\n\nWhere 'target_host' is the IP or hostname of the target and the port is specified\n`);
    process.exit(100);
}

const port = process.env.PORT || 8000;
d(`Listen on port ${port}`)
const server = http.createServer(requestListener);
server.listen(port);

// Map of client to WebSocket
const upMap = {};
const downMap = {};

const WebSocketServer = WebSocket.Server;
const webSocketServer = new WebSocketServer({ server: server });
webSocketServer
    .on("error", (error) => {
        e(`Websocket error: ${error.message || error}`);
    }).on("connection", (client, req) => {
        d(`Client connected`);

        function toIPv4(ip) {
            if (!ip) return null;

            switch (ip) {
                case "::1": return "127.0.0.1";
                case "::0": return "All";
                default: {
                    const index = ip.lastIndexOf(":");
                    return (index >= 0) ?
                        ip.substring(index + 1) : ip;
                }
            }
        }

        if (client._socket && client._socket.remoteAddress) {
            client.ip_address = toIPv4(client._socket.remoteAddress);
            d(`Client IP is ${client.ip_address}`);
        }

        const wsc = new WebSocket(`ws://${targetHost}:${targetPort}`);
        wsc.onopen = () => {
            d(`Opened client to ${targetHost}:${targetPort}`);

            upMap[client] = wsc;
            downMap[wsc] = client;
        };

        wsc.onclose = () => {
            d(`Closed client connection to ${targetHost}:${targetPort}`);
            delete upMap[client];
            delete downMap[wsc];
        };

        // Message from real server, relay to mapped client
        wsc.onmessage = (message) => {
            try {
                const str = message.data;
                d(`Got message from up: ${str}`);
                const down = downMap[wsc];
                if(down) {
                    down.send(str);
                }
            } catch(ex) {
                e(ex.message);
                console.trace();
            }
        };

        client.on("message", function(message) {
            d(`Message from ${client.ip_address}: ${message}`);
            try {
                const up = upMap[client];
                if(up) {
                    up.send(message);
                }
            } catch(ex) {
                e(ex.message);
                console.trace();
            }
        });
    });


