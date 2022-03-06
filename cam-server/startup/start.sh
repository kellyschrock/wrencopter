#!/bin/bash

set -e
set -x

APP_HOME=/home/pi/cam-server
pushd $APP_HOME

. /etc/profile.d/vehicle-env.sh

sleep 5

MEDIA_DIR=$MEDIA_SERVER_DIR ./cam-control-udp.sh


