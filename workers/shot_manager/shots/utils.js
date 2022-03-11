'use strict';

var MathUtils = null;

function d(str) {
    console.log(`utils: ${str}`);
}

function init(options) {
    MathUtils = options.MathUtils;
}

/**
 * 
 * @param {object} pos object containing the following fields:
 * . gimbal_angle: from 0 (straight down) to 90 (straight ahead)
 * . vehicle_pos: lat/lng/alt
 * . heading: heading in degrees of the vehicle
 * . distance_limit: If omitted, defaults to 1000. Prevents the calculated distance from being insanely large if the angle is too shallow.
 */
function calcFromPosition(pos) {
    const angle = pos.gimbal_angle;
    const vehiclePosition = pos.vehicle_pos;
    if(!vehiclePosition) {
        d(`No vehicle position`);
        return null;
    }

    const altitude = pos.vehicle_pos.alt;
    if(!altitude) {
        d(`no altitude`);
        return null;
    }

    const distLimit = pos.distance_limit || 1000;
    const yaw = pos.heading;

    const tan = Math.tan(Math.toRadians(angle));
    let distance = (tan * altitude);

    if(distance > distLimit) {
        distance = distLimit;
    }

    if (distance >= 0) {
        const lla = MathUtils.newCoordFromBearingAndDistance(vehiclePosition, yaw, distance);
        lla.alt = 0;
        return lla;
    } else {
        d(`calcFromPosition(): distance is ${distance}, invalid`);
        return null;
    }
}

exports.init = init;
exports.calcFromPosition = calcFromPosition;