#!/bin/sh

. ./config.env

CAM_PORT=5432

# while true; do
# 	python cam-control.py | \
# 		ffmpeg -loglevel panic -hide_banner -i - -tune zerolatency -f mpegts -codec:v mpeg1video -s 640x360 -b:v 1000k - | nc -uvlp $CAM_PORT
# done

python cam-control-motofocus.py | ffmpeg -loglevel panic -hide_banner -i - -preset:v ultrafast -tune zerolatency -f mpegts -codec:v mpeg4 -s 640x360 -b:v 1000k udp://localhost:$CAM_PORT
# python cam-control-motofocus.py | ffmpeg -loglevel panic -hide_banner -i - -tune zerolatency -codec:v mpeg4 -s 1280x720 -b:v 1000k udp://localhost:$CAM_PORT?pkt_size=188&buffer_size=65535

