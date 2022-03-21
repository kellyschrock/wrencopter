'use strict';

let MathUtils = null;

class PathGen {
    static init(mathUtils) {
        MathUtils = mathUtils;
        return new PathGen();
    }

    constructor() {
        this.pointSpacing = 0;
        this.startPoint = null;
        this.endPoint = null;
    }

    setPointSpacing(spacing) {
        this.pointSpacing = spacing;
        return this;
    }

    setStartPoint(where) {
        this.startPoint = where;
        return this;
    }

    setEndPoint(where) {
        this.endPoint = where;
        return this;
    }

    generatePath() {
        if(!this.pointSpacing) throw new Error("Call setPointSpacing() before generate()");
        if(!this.startPoint || !this.endPoint) throw new Error("Call setStartPoint() and setEndPoint() before generate()");

        const output = [];

        const distance = MathUtils.getDistance2D(this.startPoint, this.endPoint);
        const heading = MathUtils.getHeadingFromCoordinates(this.startPoint, this.endPoint);

        for(let d = 0; d < distance; d += this.pointSpacing) {
            const pt = MathUtils.newCoordFromBearingAndDistance(this.startPoint, heading, d);
            output.push(pt);
        }

        return output;
    }
}

exports.PathGen = PathGen;
