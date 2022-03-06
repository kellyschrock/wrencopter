#!/bin/sh

. ./config.env

CAM_PORT=5400

while true; do
	python cam-control.py | \
		ffmpeg -loglevel panic -hide_banner -i - -tune zerolatency -f mpegts -codec:v mpeg1video -s 1280x720 -b:v 1000k - | nc -vl $CAM_PORT
done

