#!/bin/bash

TARGET_IP=$(hostname -i)
TARGET_PORT=5432

TARGET_IP=192.168.2.15

sudo rm /tmp/cam_config.fifo > /dev/null 2>&1
sudo rm /tmp/cam_control.fifo > /dev/null 2>&1

sudo mkfifo /tmp/cam_control.fifo
sudo mkfifo /tmp/cam_config.fifo

gst-launch-1.0 rtspsrc protocols=udp location=rtsp://192.168.144.25:8554/main.264 ! \
	rtph264depay ! rtph264pay config-interval=1 pt=96 ! \
	udpsink host=$TARGET_IP port=$TARGET_PORT sync=false

# gst-launch-1.0 rtspsrc protocols=tcp location=rtsp://192.168.144.25:8554/main.264 ! udpsink host=192.168.2.253 port=5400 sync=false
# gst-launch-1.0 rtspsrc protocols=tcp location=rtsp://192.168.144.25:8554/main.264 ! udpsink host=$TARGET_IP port=$TARGET_PORT sync=false
# gst-launch-1.0 rtspsrc protocols=tcp location=rtsp://192.168.144.25:8554/main.264 ! filesink location=/dev/stdout

sudo rm /tmp/cam_config.fifo > /dev/null 2>&1
sudo rm /tmp/cam_control.fifo > /dev/null 2>&1


