#!/bin/bash

set -e
set -x

./setipconfig.js cmavnode.template.conf cmavnode.base.conf

./cmavnode -i -v -f cmavnode.base.conf
