#!/bin/bash

TARGET_IP=$(hostname -I)

sudo rm /tmp/cam_config.fifo > /dev/null 2>&1
sudo rm /tmp/cam_control.fifo > /dev/null 2>&1

sudo mkfifo /tmp/cam_control.fifo
sudo mkfifo /tmp/cam_config.fifo

python cam-control-motofocus.py | gst-launch-1.0 fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host=$TARGET_IP port=5432

sudo rm /tmp/cam_config.fifo > /dev/null 2>&1
sudo rm /tmp/cam_control.fifo > /dev/null 2>&1


