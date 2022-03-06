from datetime import datetime
import os
import utils

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

	def trigger(self):
		if self.camera is not None:
			media_dir = os.getenv("MEDIA_DIR")
			if media_dir is None:
				media_dir = "."

			filename = "{0}/{1}.jpg".format(media_dir, utils.formatDateTime(datetime.now()))

			for key, value in self.exif_tags.iteritems():
				self.camera.exif_tags[key] = value

			self.camera.capture(filename, format='jpeg')

			if self.callback is not None:
				self.callback("picture:{0}".format(filename))

