#!/bin/sh

outfile=cam-server.zip

zip -r9 $outfile *.py
zip -r9 $outfile *.sh
zip -r9 $outfile *.env 
zip -r9 $outfile startup
