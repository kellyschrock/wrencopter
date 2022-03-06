#!/bin/bash

set -e
set -x

APP_HOME=/home/pi/media-server
pushd $APP_HOME

. /etc/profile.d/vehicle-env.sh

PORT=$MEDIA_SERVER_PORT MEDIA_DIR=$MEDIA_SERVER_DIR /usr/bin/node ./media-server.js



