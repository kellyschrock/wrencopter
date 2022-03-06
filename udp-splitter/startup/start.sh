#!/bin/bash

set -e
set -x

APP_HOME=/home/pi/udp-splitter
pushd $APP_HOME

. /etc/profile.d/vehicle-env.sh

CMD_PORT=$VID_CMD_PORT
VIDEO_IN_PORT=$VID_INPUT_PORT
VIDEO_CLIENT_PORT=$VID_CLIENT_PORT

node ./udpsplitter.js $CMD_PORT $VIDEO_IN_PORT $VIDEO_CLIENT_PORT



