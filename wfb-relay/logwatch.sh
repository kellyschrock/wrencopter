#!/bin/bash

# set -e
# set -x

APP_HOME=/home/pi/wfb-relay
pushd $APP_HOME

node ./client_events.js /var/log/syslog




