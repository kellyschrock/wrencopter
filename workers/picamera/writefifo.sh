#!/bin/sh

if [ $# -lt 2 ];
then
    echo "Usage: $0 command fifo_path"
    exit 128
fi

if [ -p $2 ];
then
    echo $1 > $2 &
    pid="$!"
    sleep 0.2
    kill -9 $pid > /dev/null 2>&1
fi

exit 0
