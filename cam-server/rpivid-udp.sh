#!/bin/bash

raspivid -t 0 -w 640 -h 360 -hf -vf -fps 30 -o - | gst-launch-1.0 fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host=192.168.2.231 port=5400

