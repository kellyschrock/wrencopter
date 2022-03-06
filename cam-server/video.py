from datetime import datetime
import os
import sys

import utils

def say(str):
	print >> sys.stderr, str

class VideoRecorder:
	def __init__(self, callback):
		self.filename = ""
		self.file = None
		self.callback = callback

	def write(self, s):
		if self.file is not None:
			self.file.write(s)

	def flush(self):
		if self.file is not None:
			self.file.flush()
			self.filename = ""

	def close(self):
		if self.file is not None:
			self.file.close()
			self.file = None
			self.filename = ""

	def start(self):
		media_dir = os.getenv("MEDIA_DIR")
		if media_dir is None:
			media_dir = "."

		basename = "{0}/{1}".format(media_dir, utils.formatDateTime(datetime.now()))
		self.filename = "{0}.h264".format(basename)
		self.file = open(self.filename, "ab")

		if self.callback is not None:
			self.callback("video_start:{0}".format(self.filename))

	def stop(self):
		if self.file is not None:
			self.file.flush()
			self.file.close()
			self.file = None

			media_dir = os.getenv("MEDIA_DIR")
			if media_dir is None:
				media_dir = "."

			finalName = "{0}/{1}.mp4".format(media_dir, utils.formatDateTime(datetime.now()))
			os.system("sh convert_video.sh {0} {1} &".format(self.filename, media_dir))
			self.filename = ""

			if self.callback is not None:
				self.callback("video_stop:{0}".format(finalName))

