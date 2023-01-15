'use strict';

const http = require("http");
const WebSocket = require("ws");

function d(str) { console.log(str); }
function e(str) { console.error(str); }

function dump(o) {
    let out = "";

    for(let prop in o) {
        out += `${prop}\n`;
    }

    return out;
}

function doServer() {
    const server = http.createServer((reqest, response) => {

    });

    server.listen(3000, () => {
        d(`Server listening`);
    });

    const wsServer = new WebSocket.Server({ server: server });
    wsServer.on("request", function (request) {
        d(`server: client request`);
        const connection = request.accept(null, request.origin);
        d(`connection=${connection}`);
    })

    wsServer.on("connection", function(client) {
        d(`server: client connection from ${client._socket.remoteAddress}`);

        client.on("message", function(message) {
            d(`Holy CRAP that was difficult: ${message}`);
        })

        setTimeout(() => {
            client.send("Hey stupid, I'm the server");
        }, 500);
    });

    wsServer.on("message", function(message) {
        d(`Message from client: ${message}`);
    })
}

// Client
function doClient() {
    const socket = new WebSocket(`ws://localhost:3000`);
    socket.onopen = function() {
        d(`Client connected`);

        setTimeout(() => {
            d(`Send a message, SON OF A BITCH`)
            socket.send("Hey stupid, I'm the client");
        }, 500);
    }

    socket.onerror = function(err) {
        e(`Client error: ${err}`)
    }

    socket.onmessage = function(message) {
        d(`Client got message: ${message.data}`)
    }
}

doServer();

setTimeout(() => {
    doClient();
}, 1000);
