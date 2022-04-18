from datetime import datetime
import os
import sys

import utils

verbose = False

def say(str):
	global verbose
	if verbose:
		print >> sys.stderr, str

def getMediaDir():
	media_dir = os.getenv("MEDIA_DIR")
	if media_dir is None:
		media_dir = "."
	return media_dir

class VideoRecorder:
	def __init__(self, callback):
		self.filename = ""
		self.callback = callback
		self.camera = None

	def write(self, s):
		pass

	def flush(self):
		pass

	def close(self):
		pass

	def setCamera(self, camera):
		self.camera = camera

	def start(self):
		media_dir = getMediaDir()

		basename = "{0}/{1}".format(media_dir, utils.formatDateTime(datetime.now()))
		self.filename = "{0}.h264".format(basename)

		if self.camera is None:
			return

		say("Record to %s" % (self.filename))
		self.camera.start_recording(self.filename, format='h264', bitrate=17000000, splitter_port=2, resize=(1920, 1080))

		if self.callback is not None:
			self.callback("video_start:{0}".format(self.filename))

	def stop(self):

		if self.camera is None:
			return

		self.camera.stop_recording(splitter_port=2)

		media_dir = getMediaDir()

		if self.callback is not None:
			finalName = "{0}/{1}.mp4".format(media_dir, utils.formatDateTime(datetime.now()))
			os.system("sh convert_video.sh {0} {1} &".format(self.filename, media_dir))
			self.callback("video_stop:{0}".format(finalName))


