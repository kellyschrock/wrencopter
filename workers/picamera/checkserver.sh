#!/bin/sh

sudo systemctl is-active --quiet cam-server && echo true || echo false && sudo systemctl start cam-server

