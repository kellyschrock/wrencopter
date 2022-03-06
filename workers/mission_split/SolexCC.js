'use strict';

// SolexCC integration

const http = require("http");
const WebSocket = require("ws");

const VERBOSE = true;

function d(str) { if(VERBOSE) console.log(`SolexCC: ${str}`); }
function e(str) { console.error(`SolexCC: ${str}`); }

function checkConnection(ip, port, callback) {
    d(`checkConnection(${ip}, ${port})`);

    try {
        const req = http.get(`http://${ip}:${port}/client/ping`, (res) => {
            d(`res.statusCode=${res.statusCode}`);
            callback(res.statusCode == 200);
        }).on("error", (err) => {
            e(`checkConnection() request error: ${ex.message}`);
            callback(false);
        });

        req.end();
    } catch(ex) {
        e(ex.message);
        callback(false);
    }
}

function doGET(config, path, callback) {
    http.request({
        host: config.ip_address,
        port: config.port,
        path: path,
        method: "GET"
    }, (res) => {
        const statusCode = res.statusCode
        let result = "";
        res.on("data", (data) => {
            result += data;
        }).on("end", () => {
            callback(res.statusCode, result);
        }).on("error", (ex) => {
            e(`doGET() response error: ${ex.message}`);
        });
    }).on("error", (ex) => {
        e(`doGET() request error: ${ex.message}`);
    }).end();
}

function doPOST(config, path, params, callback) {
    const options = {
        host: config.ip_address,
        port: config.port,
        path: path,
        method: "POST"
    };

    if(params) {
        const str = JSON.stringify(params);
        options.headers = {
            "Content-Type": "application/json",
            "Content-Length": str.length
        };
    }

    const request = http.request(options, (res) => {
        let result = "";
        res.on("data", (data) => {
            result += data;
        }).on("end", () => {
            callback(res.statusCode, result);
        }).on("error", (ex) => {
            d(`doPOST() response error: ${ex.message}`);
        });
    }).on("error", (ex) => {
        d(`doPOST() request error: ${ex.message}`);
    });

    if(params) {
        const str = JSON.stringify(params);
        request.write(str);
    }

    request.end();
}

const mMessageFilters = {};

function onWSMessage(msg) {
    if(!msg) return d(`onWSMessage(): no msg`);
    if(!msg.event) return d(`onWSMessage(): no msg.event`);

    d(`onWSMessage(): ${JSON.stringify(msg)}`);

    switch(msg.event) {
        case "worker-to-gcs": {
            if(msg.data) {
                const message = msg.data.message;
                if(message) {
                    const msgId = message.id;
                    const workerId = msg.data.worker_id;

                    if(msgId) {
                        // d(`onWSMessage(): Got ${JSON.stringify(message)} from ${workerId}: ${Object.keys(mMessageFilters).length} filters`);

                        let handled = false;

                        for (let prop in mMessageFilters) {
                            const filter = mMessageFilters[prop];
                            // d(`filters[${prop}] = ${JSON.stringify(filter)}`);

                            if (!filter) continue;
                            if (!filter.matches) continue;
                            if (!filter.process) continue;

                            if (filter.matches(workerId, msgId)) {
                                // d(`filter matches ${workerId}/${msgId}`);
                                if(filter.process(workerId, msgId, message)) {
                                    d(`handled by ${filter.constructor.name} for worker ${workerId}`);
                                    handled = true;
                                }
                            }
                        }

                        if(!handled) {
                            d(`No filters handled ${workerId}/${msgId}`);
                        }
                    }
                }
            }
        }
    }
}

class SolexCC {
    constructor(config) {
        this.config = config || {};
        this.available = false;
        this.websocket = null;
        this.clientCount = 0;
        this.workers = {};
        this.subscribeSocket = null;
        this.subscribedTopics = [];
    }

    getConfig() {
        return this.config || {};
    }

    setConfig(config) {
        d(`setConfig(): ${JSON.stringify(config)}`);
        this.config = { ip_address: config.ip_address, port: config.port };
    }

    isAvailable() { return this.available; }

    connect(callback) {
        d(`connect(): ${JSON.stringify(this.config)}`);

        if(this.config.ip_address && this.config.port) {
            checkConnection(this.config.ip_address, this.config.port, (available) => {
                d(`available=${available}`);
                this.available = available;

                if(this.available) {
                    doGET(this.config, `/workers`, (statusCode, result) => {
                        const output = JSON.parse(result);
                        if(output && output.workers && output.workers.forEach) {
                            output.workers.forEach((worker) => {
                                if(worker.id) {
                                    this.workers[worker.id] = worker.name;
                                }
                            });

                            d(`${Object.keys(this.workers).length} workers installed`);
                            callback(this.available);
                        }
                    });
                }
            });
        } else {
            this.available = false;
        }
    }

    disconnect() {
        d(`disconnect()`);
        
        try {
            const topics = this.subscribedTopics.map((t) => { return t });
            if (topics.length) {
                this.unsubscribeTopics(topics);
            }
        } catch(ex) {
            e(ex.message);
        }
    }

    onVehicleDisconnected() {
        d(`onVehicleDisconnected()`);
    }

    addMessageFilter(id, filter) {
        d(`addMessageFilter(${id})`);

        mMessageFilters[id] = filter;
        return this;
    }

    removeMessageFilter(id) {
        if(mMessageFilters[id]) {
            delete mMessageFilters[id];
        }

        return this;
    }

    removeMessageFilters(ids) {
        for(const id of ids) {
            delete mMessageFilters[id];
        }

        return this;
    }

    addClientIfNone() {
        if(!this.clientCount) this.addClient();
        return this;
    }

    addClient() {
        d(`addClient(): clientCount=${this.clientCount}`);

        if(!this.available) return d(`addClient(): No CC`);

        ++this.clientCount;

        if(!this.websocket) {
            const config = this.config;
            if(config) {
                const wsu = `ws://${config.ip_address}:${config.port}`;
                d(`Connect to ${wsu}`);

                this.websocket = new WebSocket(wsu);
                this.websocket
                .on("open", () => {
                    d(`Web socket opened`);

                    // Subscribe to GCS messages
                    this.websocket.send(JSON.stringify({ type: "subscribe-gcs" }));
                }).on("close", () => {
                    d(`Web socket closed`);
                }).on("error", (err) => {
                    d(`Web socket error: ${err.message}`);
                }).on("message", (msg) => {
                    // d(`message: ${msg}`);
                    try {
                        onWSMessage(JSON.parse(msg));
                    } catch(ex) {
                        e(`Error parsing message: ${ex.message}`);
                    }
                });
            }
        }

        return this;
    }

    removeClient() {
        d(`removeClient(): clientCount=${this.clientCount}`);

        if (!this.available) return d(`removeClient(): No CC`);

        if(--this.clientCount <= 0) {
            if(this.websocket) {
                // Unsub from GCS messages
                this.websocket.send(JSON.stringify({ type: "unsubscribe-gcs" }));

                d(`Close socket`);

                this.websocket.close();
                this.websocket = null;
            }
        }

        return this;
    }

    hasWorker(workerId) {
        return (this.workers[workerId])? true: false;
    }

    checkWorkerExists(workerId, callback) {
        doGET(this.config, `/worker/details/${workerId}`, (statusCode, result) => {
            if(statusCode == 404) {
                callback(false);
            } else {
                callback(true);
            }
        });
    }

    onScreenEnter(screen, callback) {
        d(`onScreenEnter(${screen})`);

        if(!this.available) return d(`onScreenEnter(): no CC`);

        doGET(this.config, `/ui/${screen}/enter?type=html`, (statusCode, result) => {
            if(callback) {
                // d(`result=${result}`);
                callback(result);
            } else {
                d(`result=${result}`);
            }
        });
    }

    onScreenExit(screen, callback) {
        d(`onScreenExit(${screen})`);

        if (!this.available) return d(`onScreenExit(): no CC`);

        doGET(this.config, `/ui/${screen}/exit`, (statusCode, result) => {
            if (callback) {
                callback(result);
            } else {
                d(`result=${result}`);
            }
        });
    }

    sendWorkerWS(workerCommand, callback) {
        if(!workerCommand) return d(`sendWorkerWS(): No workerCommand`);

        const body = {
            id: workerCommand.msgId
        };

        if(workerCommand.params) {
            Object.assign(body, workerCommand.params);
        }

        if(mSocket) {
            mSocket.send(JSON.stringify({
                type: "gcs-to-worker",
                worker_id: workerCommand.workerId,
                msg: body
            }));
        }
    }

    sendWorkerCommand(workerCommand, callback) {
        if(!workerCommand) return d(`sendWorkerCommand(): No workerCommand`);

        const body = { id: workerCommand.msgId };
        if(workerCommand.params) {
            Object.assign(body, workerCommand.params);
        }

        doPOST(this.config, `/worker/msg/${workerCommand.workerId}`, body, (statusCode, response) => {
            if(statusCode == 200) {
                if(callback) {
                    try {
                        const jo = JSON.parse(response);
                        response = jo;
                        response.statusCode = statusCode;
                        d(JSON.stringify(response));
                    } catch (ex) {
                        e(ex.message);
                    }

                    if(response && response.ok) {
                        if(callback.onSuccess) {
                            callback.onSuccess(workerCommand, response);
                        } else {
                            d(`no onSuccess() callback`);
                        }
                    } else {
                        if(callback.onFailure) {
                            callback.onFailure(workerCommand, response);
                        } else {
                            d(`no onFailure() callback`);
                        }
                    }
                } else {
                    d(`no callback for ${statusCode}, ${response}`);
                }
            } else {
                if(callback && callback.onFailure) {
                    callback.onFailure(workerCommand, { statusCode: statusCode });
                } else {
                    d(`no onFailure() for ${statusCode}`);
                }
            }
        });
    }

    listTopics(callback) {
        try {
            doGET(this.config, `/topics`, (statusCode, result) => {
                const output = JSON.parse(result);
                if(output && output.forEach) {
                    callback(output);
                }
            });
        } catch(ex) {
            e(`Error in listTopics(): ${ex.message}`);
        }
    }

    subscribeTopics(topicsList, callback) {
        const topics = (topicsList.split) ? topicsList.split(",") : topicsList;

        function doSubscribeTopics(socket, subscribedTopics) {
            topics.forEach((t) => {
                try {
                    socket.send(JSON.stringify({ type: "subscribe-topic", topic: t }));
                    subscribedTopics.push(t);
                } catch (ex) {
                    e(`Error sending subscribe: ${ex.message}`);
                }
            });
        }

        for(const t of topics) {
            if(this.subscribedTopics.indexOf(t) >= 0) {
                d(`Already subscribed to ${t}`);
                topics.splice(topics.indexOf(t), 1);
            }
        }

        try {
            if(this.subscribeSocket) {
                doSubscribeTopics(this.subscribeSocket, this.subscribedTopics);
            } else {
                const host = `ws://${this.config.ip_address}:${this.config.port}`;

                const socket = new WebSocket(host);

                socket
                .on("open", () => {
                    d(`Opened socket`);
                    doSubscribeTopics(socket, this.subscribedTopics);
                    if(callback.onOpen) callback.onOpen();
                })
                .on("error", (ex) => { 
                    try {
                        socket.close();
                    } catch(ex) {}

                    if (callback.onError) callback.onError(ex) 
                }).on("close", () => {
                    d(`Socket closed`);
                }).on("message", (input) => {
                    const jo = JSON.parse(input);
                    if (jo.event == "topic") {
                        if (callback.onTopicMessage && topics.indexOf(jo.topic) >= 0) {
                            callback.onTopicMessage(jo.sender, jo.topic, jo.message);
                        }
                    }
                });

                this.subscribeSocket = socket;
            }

        } catch(ex) {
            e(`Error in subscribeTopic(${topic}): ${ex.message}`);
        }
    }

    unsubscribeTopics(topicsInput) {
        if(this.subscribeSocket) {
            const socket = this.subscribeSocket;

            function doUnsubscribe(topics) {
                topics.forEach((t) => {
                    d(`Unsubscribe ${t}`);
                    socket.send(JSON.stringify({ "type": "unsubscribe-topic", topic: t }));
                });
            }

            if(topicsInput) {
                const topics = (topicsInput.split)? topicsInput.split(","): topicsInput;
                topics.forEach((t) => {
                    this.subscribedTopics.splice(this.subscribedTopics.indexOf(t), 1);
                });
                
                doUnsubscribe(topics);
            } else {
                this.listTopics((topics) => {
                    doUnsubscribe(topics);

                    topics.forEach((t) => {
                        this.subscribedTopics.splice(this.subscribedTopics.indexOf(t), 1);
                    });
                });
            }
        }

        if (this.subscribedTopics.length == 0) {
            d(`Unsubscribed from all topics, closing connection`);
            if (this.subscribeSocket) {
                try {
                    this.subscribeSocket.close();
                } catch (ex) {
                    e(`Error closing socket: ${ex.message}`);
                }

                this.subscribeSocket = null;
            }
        }
    }
}

class WorkerCommand {
    constructor(workerId, msgId, params) {
        this.workerId = workerId;
        this.msgId = msgId;
        this.params = params || {};
    }

    put(name, value) {
        this.params[name] = value;
        return this;
    }
}

class MessageFilter {
    constructor() { }

    matches(workerId, msgId) { return false; }
    process(workerId, msgId, data) { return false; }
}

exports.SolexCC = SolexCC;
exports.WorkerCommand = WorkerCommand;
exports.MessageFilter = MessageFilter;

