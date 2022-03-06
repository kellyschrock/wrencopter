#!/bin/bash

TARGET_IP=$(hostname -I)

python cam-control.py | gst-launch-1.0 fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host=$TARGET_IP port=5432

