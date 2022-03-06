'use strict';

const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

function getMediaPath() {
	return process.env.MEDIA_DIR || "/home/pi/video";
}

console.log(`Serving from media directory ${getMediaPath()} on ${process.env.PORT}`);

http.createServer(function (req, res) {
	const u = url.parse(req.url, true);
	const q = u.query;

	if(u.pathname == "/download" && q.file) {
		const filename = path.join(getMediaPath(), q.file);
		if(fs.existsSync(filename)) {
			const readStream = fs.createReadStream(filename);
			readStream.on("error", () => {
				res.end();
			});

			readStream.on("open", () => {
				readStream.pipe(res);
			});

			readStream.on("close", () => {
				res.end();
			});
		} else {
			res.statusCode = 404;
			res.write(`No file named ${q.file} found in ${getMediaPath()}.`);
			res.end();
		}
	} else {
		res.write("Hi. Specify a path or something.");
		res.end();
	}

}).listen(process.env.PORT || 5595);

