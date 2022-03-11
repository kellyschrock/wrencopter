'use strict';

const fs = require("fs");
const path = require("path");
const worker = require("./worker.js");

// TODO: Make this configurable
const WORKER_LIB_DIR = "/home/kellys/work/drone/projects/solex-cc/cc/app/worker_lib";

const VEHICLE_LOCATION = { lat: 38.6430432, lng: -94.3446847, alt: 20 };

const mWorkerLibraries = {};
var mMavlinkNames = [];
var mWorkerId = null;

function d(str) {
    console.log(`worker_tester: ${str}`);
}

const mWorkerListener = {
    /** Gets a Mavlink message from the specified worker, sends it to the Mavlink output */
    onMavlinkMessage: function (workerId, msg) {
        d("onMavlinkMessage(): workerId=" + workerId + " msg=" + msg);
        // Worker sent a Mavlink message. Forward to the parent process.
        // process.send({ id: "worker_mavlink", msg: { worker_id: workerId, mavlinkMessage: msg } });
    },

    /** Gets a GCS message from the specified worker, broadcasts to all GCSMessageListeners. */
    sendGCSMessage: function (workerId, msg) {
        d(`GCS message from ${workerId}: ${msg.id}`);
        // Forward the message to the parent
        // process.send({ id: "worker_gcs", msg: { worker_id: workerId, msg: msg } });
    },

    /** Gets a message from the specified worker, sends it to all other workers in the system */
    onBroadcastMessage: function (workerId, msg) {
        d("Broadcast message from " + workerId + ": " + msg);
        // Forward to parent
        // process.send({ id: "worker_broadcast", msg: { worker_id: workerId, msg: msg } });
    },

    /** Called by a worker to get a list of the other workers on the system */
    getWorkerRoster: function (workerId) {
        return mWorkerRoster || [];
    },

    subscribeMavlinkMessages: function (workerId, messages) {
        d(`subscribeMavlinkMessages(): messages=${messages}`);

        mMavlinkNames = messages;

        d(`subscribeMavlinkMessages(): mMavlinkNames for ${mWorkerId}=${JSON.stringify(mMavlinkNames)}`);
    },

    workerLog: function (workerId, msg) {
        // Worker is logging via ATTRS.log(ATTRS.id): Forward to the parent process to handle logging.
        console.log(`${workerId}: ${msg}`);
        // process.send({ id: "worker_log", msg: { worker_id: workerId, msg: msg } });
    },

    sendBroadcastRequest: function (msg) {
        d(`sendBroadcastRequest(${JSON.stringify(msg)})`);
        // process.send({ id: "broadcast_request", msg: msg });
    },

    sendWorkerMessage: function (workerId, msg) {
        d(`sendWorkerMessage(${JSON.stringify(msg)})`);

        msg.worker_id = workerId;
        // process.send({ id: "worker_message", msg: msg });
    }
};

function attachFunctionsTo(attrs) {
    attrs.sendMavlinkMessage = mWorkerListener.onMavlinkMessage;
    attrs.sendGCSMessage = mWorkerListener.sendGCSMessage;
    attrs.broadcastMessage = mWorkerListener.onBroadcastMessage;
    attrs.getWorkerRoster = mWorkerListener.getWorkerRoster;
    attrs.subscribeMavlinkMessages = mWorkerListener.subscribeMavlinkMessages;
    attrs.log = mWorkerListener.workerLog;
    attrs.sendBroadcastRequest = mWorkerListener.sendBroadcastRequest;
    attrs.sendWorkerMessage = mWorkerListener.sendWorkerMessage;
}

function attachApisTo(attrs) {
    attrs.api = {
        // unconditional loads here
        Mavlink: mavlink
    };

    for (let prop in mWorkerLibraries) {
        attrs.api[prop] = mWorkerLibraries[prop].module;
    }
}

function loadWorkerLibsIn(dir) {
    // d(`loadWorkerLibsIn(${dir})`);

    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.map(function (file) {
        const filename = path.join(dir, file);
        const prop = path.basename(file, path.extname(file));

        try {
            // d(`load library module: ${filename}`);
            const module = require(filename);

            const lib = {
                module: module,
                cacheName: filename
            };

            if (!mWorkerLibraries) {
                mWorkerLibraries = {};
            }

            mWorkerLibraries[prop] = lib;
        } catch (ex) {
            d(`load library module error - ${filename}: ${ex.message}`);
            mWorkerLibraries[prop] = {
                error: ex.message
            };
        }
    });
}

function init() {
    try {
        loadWorkerLibsIn(WORKER_LIB_DIR);

        const attrs = worker.getAttributes();
        attachFunctionsTo(attrs);
        attachApisTo(attrs);
        worker.onLoad();

        return true;
    } catch(ex) {
        return false;
    }
}

const state = {
    location: VEHICLE_LOCATION,
    vehicle_heading: 90
};

(function() {
    if(init()) {
        const shots = (process.argv[2])? [process.argv[2]]: ["selfie", "orbit", "spiral"];

        shots.map(function(shotId) {
            worker.testShot(shotId, state);
        });
    }
})();
