#!/bin/sh

if [ $# -lt 2 ]; then
	echo Usage: $0 filename destdir
	exit 123
fi

input=$1
destdir=$2
output=$(basename $1 .h264).mp4

# Don't do this on the fly, it eats so much CPU the Pi cant stay connected.
# nice -19 MP4Box -add $input $output  > /dev/null 2>&1 && rm $input && mv $output $destdir
# mv $1 $destdir
nice -19 ffmpeg -framerate 30 -i $input -c copy $destdir/$output && rm $input




