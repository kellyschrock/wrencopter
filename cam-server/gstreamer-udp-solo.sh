#!/bin/bash

gst-launch-1.0 rpicamsrc preview=false bitrate=5000000 num-buffers=-1 hflip=true vflip=true keyframe-interval=5 ! x264enc speed-preset=ultrafast ! rtph264pay ! udpsink port=5400 host=192.168.2.231

