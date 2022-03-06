'use strict';

const os = require("os");
const nets = os.networkInterfaces();
const results = Object.create({});

for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        // skip over non-ipv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
            if (!results[name]) {
                results[name] = [];
            }

            results[name].push(net.address);
        }
    }
}

console.log(results);
console.log(`my ip: ${results[Object.keys(results)[0]][0]}`);
