#!/bin/bash

# set -e
# set -x

APP_HOME=/home/pi/wfb-relay
pushd $APP_HOME

PORT=80 $APP_HOME/scc-relay.js 10.5.0.2 80




