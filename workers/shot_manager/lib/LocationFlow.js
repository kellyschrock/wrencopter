'use strict';


const DIR_NONE = 0;
const DIR_FWD = 1;
const DIR_REV = 2;

const VERBOSE = true;

function d(str) {
    if(VERBOSE) console.log(`LocationFlow: ${str}`);
}

class LocationFlow {

    constructor(listener) {
        this.listener = listener;
        this.points = [];
        this.timerHandle = null;
        this.targetSpeed = 0;
        this.pointSpacing = 0;
        this.direction = DIR_NONE;
        this.pathIndex = 0;
        this.currVehicleSpeed = 0;
        this.running = false;
        this.autoRewind = false;
        this.waitOnVehicle = false;
    }

    isRunning() { return this.running; }

    onSpeedUpdated(vehicleSpeed) {
        this.currVehicleSpeed = vehicleSpeed;
        return this;
    }

    isAutoRewind() { return this.autoRewind; }
    setAutoRewind(rw) { this.autoRewind = rw; return this; }

    waitsOnVehicle() { return this.waitOnVehicle; }
    setWaitOnVehicle(wait) { this.waitOnVehicle = wait; return this; }

    setPoints(input) {
        this.points.splice(0, this.points.length);
        for(const i of input) {
            this.points.push(i);
        }

        return this;
    }

    setPointSpacing(distance) {
        this.pointSpacing = distance;
        this.updateTimerInterval();
        return this;
    }

    getTargetSpeed() {
        return this.targetSpeed;
    }

    setTargetSpeed(speed) {
        this.targetSpeed = speed;
        this.updateTimerInterval();
        return this;
    }

    start(direction) {
        const wasRunning = this.running;

        this.stop();
        this.running = true;

        if(!this.targetSpeed) throw new Error("call setTargetSpeed() before start()");
        if(!this.pointSpacing) throw new Error("call setPointSpacing() before start()");
        if(this.points.length == 0) throw new Error("No points to process, call setPoints()");

        this.updateTimerInterval();

        // If we were already running, preserve our place in the path.
        if(!wasRunning) {
            this.pathIndex = (direction == DIR_REV) ? this.points.length - 1 : 0;
        }

        return this.resume(direction);
    }

    pause() {
        clearTimeout(this.timerHandle);
        this.timerHandle = null;
        return this;
    }

    resume(direction) {
        this.running = true;
        this.direction = direction;
        if(!this.timerHandle) {
            this.timerHandle = setTimeout(this.processPoint.bind(this), this.timerInterval);
        }
        return this;
    }

    stop() {
        this.running = false;
        clearTimeout(this.timerHandle);
        this.timerHandle = null;
        return this;
    }

    updateTimerInterval() {
        if(this.pointSpacing && this.targetSpeed) {
            this.timerInterval = (1000 / this.targetSpeed) * this.pointSpacing;
        } else {
            this.timerInterval = 1000; // A lame/safe value
        }
    }

    nextPoint() {
        let out = null;

        if(this.autoRewind) {
            switch(this.direction) {
                case DIR_FWD: {
                    if (this.pathIndex >= (this.points.length - 1)) {
                        this.pathIndex = 0;
                    }
                    break;
                }

                case DIR_REV: {
                    if(this.pathIndex <= 0) {
                        this.pathIndex = (this.points.length - 1);
                    }
                    break;
                }
            }
        }

        switch(this.direction) {
            case DIR_FWD: {
                if(this.pathIndex < this.points.length) {
                    out = this.points[++this.pathIndex];
                }

                break;
            }

            case DIR_REV: {
                if(this.pathIndex > 0) {
                    out = this.points[--this.pathIndex];
                }
                break;
            }

            case DIR_NONE: 
            default: {
                out = null;
                break;
            }
        }

        return out;
    }

    // timer-driven function
    processPoint() {
        if(!this.running) return;

        const next = this.nextPoint();
        if(next) {
            if(this.listener.onLocation) {
                this.listener.onLocation(next, this.pathIndex, this.points.length);
            }

            // Calculate a new timerInterval to achieve desired speed.
            const currSpeed = this.currVehicleSpeed || this.targetSpeed; // If not speciied, don't process delay
            let timerInterval = this.timerInterval;

            // If not traveling at targetSpeed, wait a bit before sending the next location.
            // But not too much, otherwise it won't go anywhere.
            if(this.waitOnVehicle) {
                if (currSpeed > 0 && currSpeed < this.targetSpeed) {
                    const delay = ((1000 / currSpeed) * this.pointSpacing) / 10;
                    timerInterval += Math.min(this.timerInterval, delay);
                    d(`delay=${delay} timerInterval=${timerInterval}`);
                }
            }

            this.timerHandle = setTimeout(this.processPoint.bind(this), timerInterval);
        } else {
            if(this.listener.onComplete) {
                this.listener.onComplete(this.points);
            }
        }
    }
}

exports.LocationFlow = LocationFlow;
exports.DIR_FWD = DIR_FWD;
exports.DIR_REV = DIR_REV;
exports.DIR_NONE = DIR_NONE;
