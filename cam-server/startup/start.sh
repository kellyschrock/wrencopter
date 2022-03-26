#!/bin/bash

set -e
set -x

APP_HOME=/home/pi/cam-server
pushd $APP_HOME

. /etc/profile.d/vehicle-env.sh

MEDIA_DIR=$MEDIA_SERVER_DIR ./cam-control-udp.sh


