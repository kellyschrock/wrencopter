#!/bin/bash

python cam-control.py | gst-launch-1.0 fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! fdsink fd=1 | nc -vl 5400

