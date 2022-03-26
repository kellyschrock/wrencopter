from datetime import datetime
import os
import utils
import math
import sys

def deg_to_dms(deg, type='lat'):
        decimals, number = math.modf(deg)
        d = int(number)
        m = int(decimals * 60)
        s = (deg - d - m / 60) * 3600.00
        compass = {
            'lat': ('N','S'),
            'lon': ('E','W')
        }
		# Note: NONE of the specs for this say that the 3 rational values are comma-delimited.
        return '{}/1, {}/100, {}/1000'.format(abs(d), abs(m) * 100, math.trunc(abs(s) * 1000))

def toCoordRef(deg, type='lat'):
        decimals, number = math.modf(deg)
        d = int(number)
        compass = {
            'lat': ('N','S'),
            'lon': ('E','W')
        }
        return compass[type][0 if d >= 0 else 1]

def toAlt(alt):
	return '{}/100'.format(str(math.trunc(float(alt) * 100)))

def formatCoord(coord):
	fvalue = (float(coord) * 10000000)
	return ("%.0f / 100000" % fvalue)

def locationStringToEXIFTags(location):
	output = {}

	list = location.split(",")
	if len(list) < 3:
		return output

	try:
		output["GPS.GPSLatitude"] = deg_to_dms(float(list[0]), 'lat')
		output["GPS.GPSLatitudeRef"] = toCoordRef(float(list[0]), 'lat')
		output["GPS.GPSLongitude"] = deg_to_dms(float(list[1]), 'lon')
		output["GPS.GPSLongitudeRef"] = toCoordRef(float(list[1]), 'lon')
		output["GPS.GPSAltitude"] = toAlt(list[2])
		output["GPS.GPSAltitudeRef"] = "0" # Above MSL
	except Exception as e:
		print >> sys.stderr, e

	return output


class TakePicture:
	def __init__(self, callback):
		self.camera = None
		self.exif_tags = {}
		self.callback = callback

	def write(self, s):
		pass

	def flush(self):
		pass

	def close(self):
		pass

	def setLocation(self, str):
		exif = locationStringToEXIFTags(str)
		self.exif_tags.update(exif)
		return exif

	def trigger(self):
		if self.camera is not None:
			media_dir = os.getenv("MEDIA_DIR")
			if media_dir is None:
				media_dir = "."

			filename = "{0}/{1}.jpg".format(media_dir, utils.formatDateTime(datetime.now()))

			self.camera.exif_tags.update(self.exif_tags)

			self.camera.capture(filename, format='jpeg')

			if self.callback is not None:
				self.callback("picture:{0}".format(filename))

