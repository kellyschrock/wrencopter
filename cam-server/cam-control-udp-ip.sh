#!/bin/bash

IP=$1
PORT=5400

python cam-control.py | gst-launch-1.0 fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host=$IP port=$PORT 

