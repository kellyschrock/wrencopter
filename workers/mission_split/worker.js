'use strict';

const fs = require("fs");
const path = require("path");
let mavlink = null;

const { SolexCC, WorkerCommand } = require("./SolexCC");

const MSG_HANDSHAKE = "peer_handshake";
const MSG_SET_INDICES = "set_indices";
const MSG_GET_MISSION = "get_mission";

const ATTRS = {
    id: "mission_split",
    // Name/description
    name: "Mission split",
    description: "Splits a mission",
    // Does this worker want to loop?
    looper: false,
    // Mavlink messages we're interested in
    mavlinkMessages: []
};

const PEER_TOPICS = ["mission_state", "mission_content", "flying", "mode", "error"];
const MISSION_CONTENT_MESSAGES = ["MISSION_COUNT", "MISSION_REQUEST", "MISSION_ITEM"];
const MISSION_STATE_MESSAGES = ["MISSION_CURRENT", "MISSION_ITEM_REACHED"];

const mPeers = {};

const mState = {
    flying: false,
    auto_mode: false,
    flying_auto: false,
    mission_items: [],
    mission_item_count: 0,
    mission_state: {
        current_item: -1,
        reached_item: -1
    }
}

const VERBOSE = true;
function d(str) {
    if(VERBOSE) ATTRS.log(ATTRS.id, str);
}

function e(str) {
    console.error(`${ATTRS.id}: ${str}`);
}

function missionItemName(cmd) {
    switch(cmd) {
        case mavlink.MAV_CMD_NAV_WAYPOINT: return "Waypoint";
        case mavlink.MAV_CMD_NAV_LOITER_UNLIM: return "Loiter Unlimited";
        case mavlink.MAV_CMD_NAV_LOITER_TURNS: return "Loiter turns";
        case mavlink.MAV_CMD_NAV_LOITER_TIME: return "Loiter time";
        case mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH: return "RTL";
        case mavlink.MAV_CMD_NAV_LAND: return "Land";
        case mavlink.MAV_CMD_NAV_TAKEOFF: return "Takeoff";
        case mavlink.MAV_CMD_NAV_LAND_LOCAL: return "Land Local";
        case mavlink.MAV_CMD_NAV_TAKEOFF_LOCAL: return "Takeoff local";
        case mavlink.MAV_CMD_NAV_FOLLOW: return "Follow";
        case mavlink.MAV_CMD_NAV_CONTINUE_AND_CHANGE_ALT: return "Change Alt";
        case mavlink.MAV_CMD_NAV_LOITER_TO_ALT: return "Loiter to Alt";
        case mavlink.MAV_CMD_NAV_ROI: return "ROI";
        case mavlink.MAV_CMD_NAV_PATHPLANNING: return "Path Planning";
        case mavlink.MAV_CMD_NAV_SPLINE_WAYPOINT: return "Spline";
        case mavlink.MAV_CMD_NAV_ALTITUDE_WAIT: return "Altitude Wait";
        case mavlink.MAV_CMD_NAV_VTOL_TAKEOFF: return "VTOL Takeoff";
        case mavlink.MAV_CMD_NAV_VTOL_LAND: return "VTOL Land";
        case mavlink.MAV_CMD_NAV_GUIDED_ENABLE: return "Guided Enable";
        case mavlink.MAV_CMD_NAV_DELAY: return "Delay";
        case mavlink.MAV_CMD_NAV_PAYLOAD_PLACE: return "Payload Place";
        case mavlink.MAV_CMD_NAV_LAST: return "Nav Last";
        case mavlink.MAV_CMD_NAV_SET_YAW_SPEED: return "Set Yaw Speed";
        case mavlink.MAV_CMD_NAV_FENCE_RETURN_POINT: return "Fence return point";
        case mavlink.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION: return "Vertex Inclusion";
        case mavlink.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION: return "Vertex Exclusion";
        case mavlink.MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION: return "Circle inclusion";
        case mavlink.MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION: return "Circle exclusion";
        case mavlink.MAV_CMD_NAV_RALLY_POINT: return "Rally point";
        default: return `type ${cmd}`;
    }
}

function dump(msg) {
    const out = {};

    if(msg.fieldnames) {
        msg.fieldnames.forEach(f => out[f] = msg[f]);
    }

    return JSON.stringify(out);
}

function isLandSequenceItem(item) {
    switch (item.command) {
        case mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH:
        case mavlink.MAV_CMD_NAV_LAND:
        case mavlink.MAV_CMD_NAV_LAND_LOCAL:
        case mavlink.MAV_CMD_DO_LAND_START:
        case mavlink.MAV_CMD_NAV_VTOL_LAND:
        case mavlink.MAV_CMD_DO_VTOL_TRANSITION:
            return true;

        default: {
            return false;
        }
    }
}

function isTakeoffItem(item) {
    switch(item.command) {
        case mavlink.MAV_CMD_NAV_TAKEOFF:
        case mavlink.MAV_CMD_NAV_TAKEOFF_LOCAL:
        case mavlink.MAV_CMD_NAV_VTOL_TAKEOFF:
        case mavlink.MAV_CMD_DO_VTOL_TRANSITION:
            return true;

        default: {
            return false;
        }
    }
}

// Return the first non-waypoint/spline/etc waypoint starting from the END of the mission.
function firstLandSequenceItem() {
    if (!mState.mission_items) return null;

    let output = null;
    for(let i = mState.mission_items.length - 1; i > 0; --i) {
        const item = mState.mission_items[i];
        if (!isLandSequenceItem(item)) {
            break;
        }

        output = item;
    }

    return output;
}

function lastTakeoffItem() {
    if(!mState.mission_items) return null;

    let output = null;
    for(let i = 0, size = mState.mission_items.length; i < size; ++i) {
        const item = mState.mission_items[i];

        if(!isTakeoffItem(item)) {
            break;
        }

        output = item;
    }

    return output;
}

function areSameMission(lh, rh) {
    function err(msg) {
        d(msg);
        return false;
    }

    if(!lh) return false;
    if(!rh) return false;
    if(lh.length != rh.length) return err(`Mission lengths differ: ${lh.length} vs ${rh.length} items`);

    for(let i = 0, size = lh.length; i < size; ++i) {
        const l = lh[i];
        const r = rh[i];

        if (l.frame != r.frame) return err(`Item ${i} frame mismatch`);
        if (l.command != r.command) return err(`Item ${i} command mismatch`);
        // if (l.x != r.x) return err(`Item ${i} x mismatch: ${l.x} vs ${r.x}`);;
        // if (l.y != r.y) return err(`Item ${i} y mismatch: ${l.y} vs ${r.y}`);
        // if (l.z != r.z) return err(`Item ${i} x mismatch: ${l.z} vs ${r.z}`);
    }

    return true;
}

const mVehicleEventListener = {
    onDroneEvent: function(event, extras) {
        switch(event) {
            case ATTRS.api.Vehicle.Events.LOCATION_UPDATED: {
                mState.my_location = extras;
                break;
            }

            case ATTRS.api.Vehicle.Events.FLYING_UPDATED: {
                onFlying(extras && extras.flying || false);
                break;
            }

            case ATTRS.api.Vehicle.Events.ARM_UPDATED: {
                onArmed(extras && extras.armed || false);
                break;
            }

            case ATTRS.api.Vehicle.Events.MODE_UPDATED: {
                const state = ATTRS.api.Vehicle.getState();
                if(state) {
                    const newMode = extras.mode;
                    const autoMode = ATTRS.api.VehicleState.getAutoModeFor(state.vehicleType);
                    onAutoMode(newMode.number == autoMode.number);
                }

                break;
            }

            case ATTRS.api.Vehicle.Events.FAILSAFE: {
                // STOP EVERYTHING.
                break;
            }
        }  
    }
};

/* Return an object describing this worker. If looper is true, this module must expose a loop() export. */
function getAttributes() {
    return ATTRS;
}

function loop() { }

// Called when this worker is loaded.
function onLoad() {
    d("onLoad()");

    mavlink = ATTRS.api.mavlink;
    if(!mavlink) {
        return e("OOPS! No mavlink")
    }

    const messages = ATTRS.api.Vehicle.getVehicleMavlinkMessages()
        .concat(ATTRS.api.RCInputs.getMavlinkMessages())
        .concat(MISSION_CONTENT_MESSAGES)
        .concat(MISSION_STATE_MESSAGES)
        ;

    ATTRS.api.Vehicle.setIds(ATTRS.sysid, ATTRS.compid);
    ATTRS.api.Vehicle.setMavlinkSendCallback(function (msg) {
        // d("Send mavlink message: " + msg.name);
        ATTRS.sendMavlinkMessage(ATTRS.id, msg);
    });

    ATTRS.api.Vehicle.addEventListener(mVehicleEventListener);
    ATTRS.subscribeMavlinkMessages(ATTRS.id, messages);
}

// Called when unloading
function onUnload() {
    d("onUnload()");
}

function resetMissionItemState() {
    d(`resetMissionItemState()`);
    mState.mission_items = [];
    mState.mission_item_count = 0;
}

function onMissionContentMessage(msg) {
    // d(`got ${msg.name}=${dump(msg)}`);

    function findItemWithSeq(items, seq) {
        return items.find((item) => item.seq == seq);
    }

    switch (msg.name) {
        case "MISSION_COUNT": {
            if(mState.mission_item_count != msg.count) {
                // Must be a new mission
                mState.mission_item_count = msg.count;
                mState.mission_items = [];
                mState.got_local_mission = false;

                if(mState.requesting_mission) {
                    d(`Request first item`);
                    ATTRS.sendMavlinkMessage(ATTRS.id, new mavlink.messages.mission_request(ATTRS.sysid, ATTRS.compid, msg.seq + 1));
                }
            } else {
                // d(`Why am I getting this bullshit?`);
            }
            break;
        }

        case "MISSION_ITEM": {
            if (!mState.mission_items) mState.mission_items = [];

            const already = findItemWithSeq(mState.mission_items, msg.seq);
            if(already) {
                // Where is this extra bullshit coming from? Sometimes I get multiple MISSION_ITEM messages for the same mission item.
            } else {
                mState.mission_items.push(Object.assign({}, msg));
            }

            if (mState.mission_item_count == mState.mission_items.length) {
                d(`Got the local mission: ${mState.mission_items.length} items`);

                // Probably got these out of sequence, so make sure they're sorted.
                mState.mission_items.sort((a, b) => a.seq - b.seq);

                delete mState.requesting_mission;
                mState.got_local_mission = true;
                onGotLocalMission();
            } else {
                if(mState.requesting_mission) {
                    const nextSeq = msg.seq + 1;
                    d(`Request next item: ${nextSeq}`);
                    ATTRS.sendMavlinkMessage(ATTRS.id, new mavlink.messages.mission_request(ATTRS.sysid, ATTRS.compid, nextSeq));
                }
            }

            break;
        }
    }
}

function onMissionStateMessage(msg) {
    if (mState.flying_auto) {
        // d(`${msg.name}=${dump(msg)}`);

        function findItemBySeq(items, seq) {
            return items.find((item) => item.seq == seq);
        }

        switch (msg.name) {
            case "MISSION_CURRENT": {
                if (mState.mission_state.current_item != msg.seq) {
                    mState.mission_state.current_item = msg.seq;
                    const found = findItemBySeq(mState.mission_items, msg.seq);
                    const name = (found)? missionItemName(found.command): "Unknown";
                    d(`Current item is ${msg.seq}: ${name}`);
                }
                break;
            }

            case "MISSION_ITEM_REACHED": {
                if (mState.mission_state.reached_item != msg.seq) {
                    mState.mission_state.reached_item = msg.seq;
                    const found = findItemBySeq(mState.mission_items, msg.seq);
                    const name = (found) ? missionItemName(found.command) : "Unknown";
                    d(`Reached item ${msg.seq}: ${name}`);

                    if (mState.mission_start_index && !mState.skipped_to_index) {
                        // Want to avoid going to the first waypoint item if we're doing a later part of a split mission.
                        const item = mState.mission_items && mState.mission_items[Math.max(1, msg.seq + 1)];
                        if (!isTakeoffItem(item)) {
                            d(`Done with mission start, skip to ${mState.mission_start_index}`);
                            sendStatusMessage(`Done with mission start, skip to ${mState.mission_start_index}`);
                            mState.skipped_to_index = true;
                            skipToMissionIndex(mState.mission_start_index);
                        }
                    }

                    if (msg.seq >= mState.mission_end_index) {
                        // Our part of the mission is done. Skip to the end.
                        const lastItem = firstLandSequenceItem();
                        if (lastItem) {
                            d(`Our work here is done. Skip to item ${lastItem.seq}`);
                            skipToMissionIndex(lastItem.seq);
                            sendStatusMessage(`Done with this part of the mission, skip to ${lastItem.seq}`)
                        } else {
                            e(`Didn't find a land sequence item for ${mState.mission_end_index}.`);
                        }
                    }
                }

                break;
            }
        }
    }
}

// Called when a Mavlink message arrives
function onMavlinkMessage(msg) {
    ATTRS.api.Vehicle.onMavlinkMessage(msg);
    // ATTRS.api.RCInputs.onMavlinkMessage(msg);

    if(MISSION_CONTENT_MESSAGES.indexOf(msg.name) >= 0) {
        onMissionContentMessage(msg);
    } else if(MISSION_STATE_MESSAGES.indexOf(msg.name) >= 0) {
        onMissionStateMessage(msg);
    }
}

function skipToMissionIndex(index) {
    d(`skipToMissionIndex(${index})`);

    const seq = parseInt(index);
    if(isNaN(seq)) {
        return d(`Specified index ${seq} is invalid`);
    }
    
    const msg = new mavlink.messages.mission_set_current();
    msg.target_system = ATTRS.sysid;
    msg.target_component = ATTRS.compid;
    msg.seq = seq;
    ATTRS.sendMavlinkMessage(ATTRS.id, msg);
}

// Called when the GCS sends a message to this worker. Message format is 
// entirely dependent on agreement between the FCS and worker implementation.
function onGCSMessage(msg) {
    d(`onGCSMessage(): msg=${JSON.stringify(msg)}`);

    const result = {
        ok: true
    };

    switch(msg.id) {
        case MSG_HANDSHAKE: {
            result.ok = true;
            break;
        }

        case MSG_SET_INDICES: {
            mState.mission_start_index = parseInt(msg.start_index);
            mState.mission_end_index = parseInt(msg.end_index);
            d(`Setting my indices to ${mState.mission_start_index}, ${mState.mission_end_index}`);
            sendStatusMessage(`Mission indices set to ${mState.mission_start_index}, ${mState.mission_end_index}`);
            result.ok = true;
            break;
        }

        case MSG_GET_MISSION: {
            downloadMission(msg);
            break;
        }

        default: {
            result.ok = false;
            result.message = `Unknown message: ${msg.id}`;
            break;
        }
    }

    return result;
}

function onFlying(flying) {
    d(`onFlying(${flying})`);

    if(mState.flying != flying) {
        mState.flying = flying;

        if(flying) {
            d(`Taking off`);
            onStartFlying();
        } else {
            d(`Landed`);
            onStopFlying();
        }
    }

    const flying_auto = (mState.flying && mState.auto_mode && mState.armed);
    if(mState.flying_auto != flying_auto) {
        if(flying_auto) {
            onStartFlyingAuto();
        } else {
            onStopFlyingAuto();
        }

        mState.flying_auto = flying_auto;
    }
}

function onArmed(armed) {
    d(`onArmed(${armed})`);

    mState.armed = armed;
    mState.flying_auto = (mState.flying && mState.auto_mode && mState.armed);

    if(armed) {
        // We'll get more mission items shortly
        resetMissionItemState();
    } else {
        mState.mission_state.current_item = -1;
        mState.mission_state.reached_item = -1;
        delete mState.skipped_to_index;
        delete mState.mission_start_index;
        delete mState.mission_end_index;
    }
}

function onAutoMode(isAuto) {
    d(`onAutoMode(${isAuto})`);

    if(mState.auto_mode != isAuto) {
        if(isAuto) {
            d(`Switching to auto`);
        } else {
            d(`Switching from auto`);
        }

        mState.auto_mode = isAuto;
    }

    const flying_auto = (mState.flying && mState.auto_mode && mState.armed);
    if (mState.flying_auto != flying_auto) {
        if (flying_auto) {
            onStartFlyingAuto();
        } else {
            onStopFlyingAuto();
        }

        mState.flying_auto = flying_auto;
    }
}

function onGotLocalMission() {
    d(`onGotLocalMission()`);
    sendStatusMessage(`Got the local mission: ${mState.mission_items.length} items`);

    // We got the mission. If we're also flying, ready to split the mission with peers
    if(mState.flying) {
        onMissionSplitReady();
    }
}

function onStartFlying() {
    d(`onStartFlying()`);

    sendStatusMessage("Taking off");
    
    // We're flying. If we also have the local mission, ready to split the mission with peers
    if(mState.got_local_mission) {
        onMissionSplitReady();
    }
}

function onStopFlying() {
    d(`onStopFlying()`);

    sendStatusMessage("Land");
}

function onStartFlyingAuto() {
    d(`onStartFlyingAuto()`);
}

function onStopFlyingAuto() {
    d(`onStopFlyingAuto()`);
}

function onMissionSplitReady() {
    d(`onMissionSplitReady()`);

    const now = Date.now();
    delete mState.mission_start_index;
    delete mState.mission_end_index;
    if (!mState.mission_items) return e(`No mission items!`);
    if (mState.mission_items.length == 0) return e(`No mission item length!`);

    const peersFlyingThisMission = [];

    let highestCurrIndex = 0;

    // Collect the peers that are flying this mission.
    for (let id in mPeers) {
        const peer = mPeers[id];

        if (!peer) { d(`no peer at ${id}`); continue; }
        const mission = peer.mission_content;

        if (!peer.mission_content) { e(`Peer at ${id} has no mission_content.`); continue; }
        if (!peer.flying) { d(`Peer ${id} is not flying.`); continue; }
        if (!peer.fly_start_time) { d(`Peer ${id} has no fly_start_time.`); continue; }
        if (!mission) { d(`Peer ${id} has no mission_content`); continue; }

        if (mission.items && mState.mission_items) {
            if (areSameMission(mission.items, mState.mission_items)) {
                d(`Running the same mission as peer ${id}`);
                peer.id = id;
                peersFlyingThisMission.push(peer);
            } else {
                d(`${id} is running a different mission than us`);
            }
        }
    }

    // Sort the peer list by fly_start_time
    if (peersFlyingThisMission.length == 0) {
        sendStatusMessage(`No peers flying this mission (yet)`);
        return d(`No peers flying this mission yet.`);
    }

    peersFlyingThisMission.sort((a, b) => a.fly_start_time - b.fly_start_time);

    const totalFlyerCount = peersFlyingThisMission.length + 1;
    d(`${totalFlyerCount} total machines flying this mission: ${mState.mission_items.length} items`);
    sendStatusMessage(`${totalFlyerCount} total machines flying this mission: ${mState.mission_items.length} items`);

    // Split the mission by total peers.
    // For a 100-point mission with 4 total peers, splitSize is 25 for example.
    const splitSize = (mState.mission_items.length / totalFlyerCount);
    d(`splitSize=${splitSize}`)
    let peerStartIndex = 0;
    let peerEndIndex = splitSize - 1;

    for (const peer of peersFlyingThisMission) {
        const peerCurrIndex = (peer.mission_state && peer.mission_state.current_item) || undefined;

        if (peerCurrIndex > peerEndIndex) {
            // Bail, this is fatal. If > 1 peer is already flying, this copter won't participate is all.
            sendStatusMessage(`Peer ${peer.id} is too far into the mission at ${peerCurrIndex}, aborting.`);
            return d(`Peer ${peer.id} is already ahead of it's planned end index! Moral of the story is LAUNCH SOONER`);
        }

        if (peerCurrIndex > highestCurrIndex) {
            highestCurrIndex = peer.mission_state.current_item;
        }

        if (peer.cc) {
            const cmd = { start_index: peerStartIndex.toFixed(0), end_index: peerEndIndex.toFixed(0) };
            d(`Set indices to ${JSON.stringify(cmd)} on ${peer.id}`);

            peer.cc.sendWorkerCommand(new WorkerCommand(ATTRS.id, MSG_SET_INDICES, cmd), {
                onSuccess: (command, response) => {
                    if (response.ok) {
                        d(`Set indices ok for ${peer.id}`);
                    }
                },

                onFailure: (command, response) => {
                    e(`Failed to set indices for peer ${peer.id}: ${response.message}`);
                    sendStatusMessage(`Failed to set indices for ${peer.id}: ${response.message}`);
                }
            });
        }

        peerStartIndex += splitSize;
        peerEndIndex += splitSize;
    }

    // We're the last flying copter, so we'll take the last part of the mission.
    // If another copter is launched and hovered after this one, these indices
    // will be adjusted to something else.
    mState.mission_start_index = peerStartIndex.toFixed(0);
    mState.mission_end_index = peerEndIndex.toFixed(0);
    d(`Set THIS machine's indices to start=${mState.mission_start_index}, end=${mState.mission_end_index}`);
    sendStatusMessage(`Will fly mission from index ${mState.mission_start_index} to ${mState.mission_end_index}`);
}

function onPeerMissionContent(sender, mission) {
    d(`onPeerMissionContent(${sender.address}): ${mission.items.length} items`);

    // content is {count: x, items: []}
    mPeers[sender.address].mission_content = mission;
}

function onPeerMissionState(sender, msg) {
    d(`onPeerMissionState(${sender.address}): ${JSON.stringify(msg)}`);
    // {"current_item":15,"reached_item":15,"count":16}

    mPeers[sender.address].mission_state = Object.assign({}, msg);
}

function onPeerFlying(sender, msg) {
    d(`onPeerFlying(${sender.address}): ${JSON.stringify(msg)}`);

    const flying = msg.flying;

    if(mPeers[sender.address].flying != flying) {
        if(flying) {
            mPeers[sender.address].flying = true;
            mPeers[sender.address].fly_start_time = Date.now();
        } else {
            mPeers[sender.address].flying = false;
            delete mPeers[sender.address].fly_start_time;
        }

        mPeers[sender.address].flying = flying;
        d(`Peer ${sender.address} flying=${mPeers[sender.address].flying}`);
    }

    const flying_auto = (mPeers[sender.address].auto_mode && mPeers[sender.address].flying);
    if (mPeers[sender.address].flying_auto != flying_auto) {
        if (flying_auto) {
            mPeers[sender.address].mission_start_time = Date.now();
        } else {
            delete mPeers[sender.address].mission_start_time;
        }

        mPeers[sender.address].flying_auto = flying_auto;
    }
}

function onPeerMode(sender, msg) {
    d(`onPeerMode(${sender.address}): ${JSON.stringify(msg)}`);

    const autoMode = ATTRS.api.VehicleState.getAutoModeFor(msg.vehicle_type);
    mPeers[sender.address].auto_mode = (autoMode.number == msg.mode);

    const flying_auto = (mPeers[sender.address].auto_mode && mPeers[sender.address].flying);
    if (mPeers[sender.address].flying_auto != flying_auto) {
        if(flying_auto) {
            mPeers[sender.address].mission_start_time = Date.now();
        } else {
            delete mPeers[sender.address].mission_start_time;
        }

        mPeers[sender.address].flying_auto = flying_auto;
    }
}

function downloadMission(msg) {
    d(`downloadMission()`);
    mState.requesting_mission = true;
    ATTRS.sendMavlinkMessage(ATTRS.id, new mavlink.messages.mission_request_list(ATTRS.sysid, ATTRS.compid));
}

function onPeerError(sender, msg) {
    d(`onPeerError(${sender.address}): ${JSON.stringify(msg)}`);

    sendStatusMessage(`Peer ${sender.address} reported error: ${msg.message}`);
}

function sendStatusMessage(msg) {
    ATTRS.sendGCSMessage(ATTRS.id, { id: "worker_log", message: msg });
}

exports.onIVCPeerAdded = (peer) => {
    d(`Added IVC peer at ${JSON.stringify(peer)}`);

    if(!peer) return d(`no peer`);
    if(!peer.address) return d(`no peer address: ${JSON.stringify(peer)}`);

    // Call the peer and find out if it has this worker on it.
    // If it doesn't, don't connect to it.
    const other = mPeers[peer.address];
    let cc = other && other.cc;
    if(cc) {
        // We must have gotten reconnected after it dropped and came back. Damn you UDP
    } else {
        cc = new SolexCC({ ip_address: peer.address, port: peer.port });

        cc.connect((available) => {
            if(available) {
                // CC is on the other machine. Tell it something
                cc.sendWorkerCommand(new WorkerCommand(ATTRS.id, MSG_HANDSHAKE, {}), {
                    onSuccess: (command, response) => {
                        if(response.ok) { // TODO: Un-hose this!
                            d(`Peer at ${peer.address} can split missions. Subscribe`);
                            mPeers[peer.address] = { cc: cc };

                            cc.subscribeTopics(PEER_TOPICS, {
                                onOpen: () => {
                                    d(`Subscribed to ${PEER_TOPICS} on ${peer.address}`);
                                    sendStatusMessage(`Subscribed to ${PEER_TOPICS} on ${peer.address}`);
                                },

                                onError: (ex) => {
                                    e(`Error subscribing to topics: ${ex.message}`);
                                    sendStatusMessage(`Error subscribing to topics: ${ex.message}`);
                                },

                                onTopicMessage: (sender, topic, message) => {
                                    switch(topic) {

                                        case "mission_state": {
                                            // sender should tell which of the machines is sending the message.
                                            // message should tell current_item (wp headed to), reached_item (last-reached wp) and item_count.
                                            onPeerMissionState(sender, message);
                                            break;
                                        }

                                        case "mission_content": {
                                            onPeerMissionContent(sender, message);
                                            break;
                                        }

                                        case "flying": {
                                            onPeerFlying(sender, message);
                                            break;
                                        }

                                        case "mode": {
                                            onPeerMode(sender, message);
                                            break;
                                        }

                                        case "error": {
                                            onPeerError(sender, message);
                                            break;
                                        }
                                    }
                                }
                            });
                        } else {
                            d(`Peer at ${peer.address} doesn't split missions`);
                        }
                    },

                    onFailure: (command, response) => {
                        e(`Peer at ${peer.address} doesn't support ${ATTRS.id}: statusCode=${response.statusCode}`);
                        delete mPeers[peer.address];
                    }
                });
            }
        });
    }
}

exports.onIVCPeerDropped = (peer) => {
    d(`Peer at ${peer.address} dropped`);

    const other = mPeers[peer.address];

    if(other && other.cc) {
        other.cc.disconnect();
        delete mPeers[peer.address];
    }
}

exports.getAttributes = getAttributes;
exports.loop = loop;
exports.onLoad = onLoad;
exports.onUnload = onUnload;
exports.onMavlinkMessage = onMavlinkMessage;
exports.onGCSMessage = onGCSMessage;
