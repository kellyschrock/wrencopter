'use strict';

const { SerialPort } = require('serialport');

function d(str) { console.log(`comport: ${str}`); }
function e(str) { console.error(`comport: ${str}`); }

class ComPort {
    constructor(portId, baudRate, listener) {
        this.portId = portId;
        this.baudRate = baudRate;
        this.listener = listener;

        this.port = new SerialPort({
            path: this.portId,
            baudRate: this.baudRate,
        });

        this.port.on("error", (err) => {
            e(err);
            this.callListenerError(err);
        }).on("open", () => {
            if(this.listener && this.listener.onOpen) {
                this.listener.onOpen();
            }
        }).on("data", (data) => {
            this.callListenerData(data);
        });
    }

    send(packet) {
        this.port.write(Buffer.from(packet), (err) => {
            if(err) {
                return this.callListenerError(err);
            }
        });
    }

    callListenerError(error) {
        if(this.listener && this.listener.onError) {
            this.listener.onError(error);
        }
    }

    callListenerData(data) {
        if(this.listener && this.listener.onData) {
            this.listener.onData(data);
        }
    }
}

exports.ComPort = ComPort;
