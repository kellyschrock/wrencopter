#!/bin/sh

if [ $# -lt 2 ]; then
	echo Usage: $0 filename destdir
	exit 123
fi

input=$1
destdir=$2
output=$(basename $1 .h264).mp4

MP4Box -add $input $output  > /dev/null 2>&1 && rm $input && mv $output $destdir



