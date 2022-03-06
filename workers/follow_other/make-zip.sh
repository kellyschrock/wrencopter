#!/bin/sh

name=$(basename `pwd`).zip
echo creating $name
zip -r9 $name *.js

